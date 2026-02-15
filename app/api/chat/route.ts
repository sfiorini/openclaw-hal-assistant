import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"

import { applyCorsHeaders, corsPreflightResponse } from "../../../lib/middleware/cors"
import { createLogger } from "../../../lib/middleware/logger"
import { limitRequest } from "../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../lib/middleware/auth"
import { chatJobSubmissionResponseSchema, chatRequestSchema } from "../../../lib/schemas/chat.schema"
import { getServerEnvConfig } from "../../../lib/config/env"
import {
  createChatJob,
  getChatJobById,
  getPollAfterMs,
  markChatJobFinalized,
  markChatJobProgress,
  markChatJobRunning,
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

const executeChatJob = async (
  jobId: string,
  payload: {
    message: string
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
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
      },
      config.requestTimeoutMs
    )

    const latestState = getChatJobById(jobId)
    if (!latestState || latestState.status !== "running") {
      logger.info(`[${CHAT_OPERATION}] job no longer running before completion: ${jobId}`)
      return
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
    const job = createChatJob({
      message: payload.message,
      conversationHistory: payload.conversationHistory,
      idempotencyKey: readIdempotencyKey(request),
    })

    void executeChatJob(
      job.id,
      {
        message: job.request.message,
        conversationHistory: job.request.conversationHistory,
      },
      {
        gatewayUrl: env.OPENCLAW_GATEWAY_URL,
        token: env.OPENCLAW_GATEWAY_TOKEN,
        agentId: env.OPENCLAW_AGENT_ID,
        requestTimeoutMs: env.OPENCLAW_CHAT_REQUEST_TIMEOUT_MS,
      }
    )

    const responsePayload = chatJobSubmissionResponseSchema.parse({
      jobId: job.id,
      status: "queued",
      pollAfterMs: getPollAfterMs("queued"),
      maxPollAttempts: POLL_CONFIG.maxPollAttempts,
      maxWaitMs: POLL_CONFIG.maxWaitMs,
    })
    logger.info(`[${CHAT_OPERATION}] accepted job: ${job.id}`)

    return buildJsonResponse(request, 202, responsePayload)
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "concurrency_error"
    ) {
      const message = (error as { message?: string }).message || "Maximum concurrent jobs exceeded"
      return buildJsonResponse(request, 503, {
        error: "Concurrency limit reached",
        code: "concurrency_error",
        message,
        retryable: true,
        retryAfterMs: POLL_CONFIG.initialPollAfterMs,
      })
    }

    logger.error(`Chat route error: ${getErrorMessage(error)}`)
    return buildJsonResponse(request, 500, {
      error: "Internal server error",
    })
  }
}
