import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"

import { applyCorsHeaders, corsPreflightResponse } from "../../../lib/middleware/cors"
import { createLogger } from "../../../lib/middleware/logger"
import { limitRequest } from "../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../lib/middleware/auth"
import {
  chatJobSubmissionResponseSchema,
  chatRequestSchema,
} from "../../../lib/schemas/chat.schema"
import { parseChatSessionCommand } from "../../../lib/chat/schemas/session.schema"
import {
  getOrCreateSession,
  getSessionForJobLimitCheck,
  appendToSessionConversation,
  releaseSessionJobSlot,
  setSessionLastJobId,
  setSessionModelInitialized,
} from "../../../lib/chat/sessions"
import { getServerEnvConfig } from "../../../lib/config/env"
import {
  createChatJob,
  getChatJobById,
  getChatJobByIdempotencyKey,
  getPollAfterMs,
  markChatJobFinalized,
  markChatJobProgress,
  markChatJobRunning,
  type ChatJobStatus,
  POLL_CONFIG,
} from "../../../lib/chat/jobs"
import { chatWithOpenClaw, mapOpenClawError } from "../../../lib/openclaw/chat"

const logger = createLogger()
const CHAT_OPERATION = "chat.submit"

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error")

const buildJsonResponse = (request: NextRequest, status: number, body: Record<string, unknown>) =>
  applyCorsHeaders(
    NextResponse.json(body, {
      status,
    }),
    request
  )

const readIdempotencyKey = (request: NextRequest) => {
  const key = request.headers.get("Idempotency-Key") ?? request.headers.get("idempotency-key")
  if (!key) {
    return undefined
  }
  return key.trim() || undefined
}

const buildSubmissionResponse = (job: {
  id: string
  sessionId: string
  status: ChatJobStatus
  attemptCount?: number
}) =>
  chatJobSubmissionResponseSchema.parse({
    jobId: job.id,
    sessionId: job.sessionId,
    status: "queued",
    pollAfterMs: getPollAfterMs(job.status, job.attemptCount ?? 0),
    maxPollAttempts: POLL_CONFIG.maxPollAttempts,
    maxWaitMs: POLL_CONFIG.maxWaitMs,
  })

const resolveSessionContext = async (payload: {
  message: string
  sessionId?: string
  newSession: boolean
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
  appName: string
  gatewayUsername: string
  defaultSessionId?: string
  defaultAgentModel?: string
}) => {
  const parsed = parseChatSessionCommand(payload.message)
  const shouldCreateNewSession = payload.newSession || parsed.newSession
  const requestedSessionId = payload.sessionId ?? payload.defaultSessionId
  const shouldForceDefaultSession =
    !shouldCreateNewSession && !!payload.defaultSessionId && !payload.sessionId
  const session = await getOrCreateSession(
    shouldCreateNewSession ? undefined : requestedSessionId,
    shouldCreateNewSession,
    shouldCreateNewSession ? [] : payload.conversationHistory,
    {
      appName: payload.appName,
      gatewayUsername: payload.gatewayUsername,
      requestedSessionId: shouldForceDefaultSession ? requestedSessionId : undefined,
      forceRequestedSessionId: shouldForceDefaultSession,
    }
  )
  let message = parsed.message
  if (!shouldCreateNewSession && !session.modelInitialized && payload.defaultAgentModel?.trim()) {
    const normalizedModel = payload.defaultAgentModel.trim()
    message = parsed.message.length > 0 ? `/new ${normalizedModel} ${parsed.message}` : `/new ${normalizedModel}`
    await setSessionModelInitialized(session.id)
  }

  return {
    message,
    conversationHistory: session.conversation,
    sessionId: session.id,
  }
}

const executeChatJob = async (
  jobId: string,
  payload: {
    message: string
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
    sessionId: string
  },
  config: { gatewayUrl: string; token: string; agentId: string; requestTimeoutMs: number }
) => {
  const startedAt = Date.now()
  logger.info(`[${CHAT_OPERATION}] job started: ${jobId}`)

  markChatJobProgress(jobId, "dispatching_to_openclaw")
  const runningJob = markChatJobRunning(jobId)
  if (!runningJob) {
    return
  }

  try {
    markChatJobProgress(jobId, "waiting_for_upstream")
    const result = await chatWithOpenClaw(
      {
        message: payload.message,
        conversationHistory: payload.conversationHistory,
        gatewayUrl: config.gatewayUrl,
        gatewayToken: config.token,
        agentId: config.agentId,
        sessionId: payload.sessionId,
      },
      config.requestTimeoutMs
    )

    const latestState = getChatJobById(jobId)
    if (!latestState || latestState.status !== "running") {
      logger.info(`[${CHAT_OPERATION}] job no longer running before completion: ${jobId}`)
      return
    }

    try {
      await appendToSessionConversation(payload.sessionId, [
        {
          role: "user",
          content: payload.message,
        },
        {
          role: "assistant",
          content: result.text,
        },
      ])
    } catch (error) {
      logger.warn(
        `[${CHAT_OPERATION}] unable to persist chat turn for session ${payload.sessionId}: ${getErrorMessage(
          error
        )}`
      )
    }

    const durationMs = Date.now() - startedAt
    markChatJobProgress(jobId, "finalizing")
    markChatJobFinalized(
      jobId,
      "completed",
      {
        response: {
          text: result.text,
          conversationHistory: result.conversationHistory,
        },
      },
      "request"
    )
    logger.info(`[${CHAT_OPERATION}] job completed in ${durationMs}ms: ${jobId}`)
  } catch (error) {
    const current = getChatJobById(jobId)
    if (current?.status === "cancelled" || current?.status === "completed") {
      logger.info(`[${CHAT_OPERATION}] job cancelled before completion: ${jobId}`)
      return
    }

    const mapped = mapOpenClawError(error)
    markChatJobFinalized(
      jobId,
      "failed",
      {
        error: {
          code: mapped.code,
          message: mapped.message,
          details: mapped.details,
        },
      },
      "request"
    )
    logger.error(`[${CHAT_OPERATION}] job failed (${jobId}): ${mapped.message}`)
  }
}

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request)
}

export async function POST(request: NextRequest) {
  let env

  try {
    env = getServerEnvConfig()
  } catch (error) {
    return buildJsonResponse(request, 500, { error: getErrorMessage(error) })
  }

  const authResponse = await withApiKeyAuth(request, {
    requiredApiKey: env.OPENCLAW_API_KEY,
  })
  if (authResponse) {
    return buildJsonResponse(request, 401, await authResponse.json())
  }

  const rateLimitResponse = limitRequest(request, env.OPENCLAW_RATE_LIMIT)
  if (rateLimitResponse) {
    return applyCorsHeaders(rateLimitResponse, request)
  }

  const idempotencyKey = readIdempotencyKey(request)
  if (idempotencyKey) {
    const existing = getChatJobByIdempotencyKey(idempotencyKey)
    if (existing) {
      return buildJsonResponse(request, 202, buildSubmissionResponse(existing))
    }
  }

  let payload
  try {
    payload = chatRequestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return buildJsonResponse(request, 400, {
        error: "Invalid request",
        details: error.errors.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      })
    }

    logger.error(`Chat request validation error: ${getErrorMessage(error)}`)
    return buildJsonResponse(request, 400, { error: "Invalid request" })
  }

  try {
    const sessionContext = await resolveSessionContext({
      message: payload.message,
      sessionId: payload.sessionId,
      newSession: payload.newSession,
      conversationHistory: payload.conversationHistory,
      appName: env.OPENCLAW_APP_NAME,
      gatewayUsername: env.OPENCLAW_GATEWAY_USERNAME,
      defaultSessionId: env.OPENCLAW_SESSION_ID,
      defaultAgentModel: env.OPENCLAW_DEFAULT_AGENT_MODEL,
    })
    await getSessionForJobLimitCheck(sessionContext.sessionId)
    let job
    try {
      job = createChatJob({
        message: sessionContext.message,
        conversationHistory: sessionContext.conversationHistory,
        sessionId: sessionContext.sessionId,
        idempotencyKey,
      })
      await setSessionLastJobId(sessionContext.sessionId, job.id)
    } catch (error) {
      await releaseSessionJobSlot(sessionContext.sessionId)
      throw error
    }

    void executeChatJob(
      job.id,
      {
        message: job.request.message,
        conversationHistory: job.request.conversationHistory,
        sessionId: job.sessionId,
      },
      {
        gatewayUrl: env.OPENCLAW_GATEWAY_URL,
        token: env.OPENCLAW_GATEWAY_TOKEN,
        agentId: env.OPENCLAW_AGENT_ID,
        requestTimeoutMs:
          env.OPENCLAW_CHAT_REQUEST_TIMEOUT_MS ?? env.OPENCLAW_GATEWAY_TIMEOUT_MS ?? 120_000,
      }
    )

    const responsePayload = buildSubmissionResponse(job)
    logger.info(`[${CHAT_OPERATION}] accepted job: ${job.id}`)

    return buildJsonResponse(request, 202, responsePayload)
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code) {
      const code = (error as { code?: string }).code
      const message = (error as { message?: string }).message

      if (code === "session_limit_exceeded" || code === "concurrency_error") {
        return buildJsonResponse(request, 503, {
          error: "Concurrency limit reached",
          code,
          message: message || "Maximum concurrent work in progress",
          retryable: true,
          retryAfterMs: POLL_CONFIG.initialPollAfterMs,
        })
      }

      if (code === "session_not_found") {
        return buildJsonResponse(request, 404, {
          error: "Session not found",
          code,
          message: message || "Session does not exist",
        })
      }
    }

    logger.error(`Chat route error: ${getErrorMessage(error)}`)
    return buildJsonResponse(request, 500, {
      error: "Internal server error",
    })
  }
}
