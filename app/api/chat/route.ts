import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"

import { applyCorsHeaders, corsPreflightResponse } from "../../../lib/middleware/cors"
import { createLogger } from "../../../lib/middleware/logger"
import { limitRequest } from "../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../lib/middleware/auth"
import {
  chatRequestSchema,
  chatResponseSchema,
} from "../../../lib/schemas/chat.schema"
import {
  chatSessionIdSchema,
  parseChatSessionCommand,
} from "../../../lib/chat/schemas/session.schema"
import {
  getOrCreateSession,
  getSessionForJobLimitCheck,
  appendToSessionConversation,
  releaseSessionJobSlot,
  setSessionModelInitialized,
} from "../../../lib/chat/sessions"
import { getServerEnvConfig } from "../../../lib/config/env"
import { chatWithGateway } from "../../../lib/openclaw/gateway-client"
import { GatewayClientError } from "../../../lib/openclaw/gateway.types"

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
  const shouldForceRequestedSession = !shouldCreateNewSession && !!requestedSessionId

  const session = await getOrCreateSession(
    shouldCreateNewSession ? undefined : requestedSessionId,
    shouldCreateNewSession,
    shouldCreateNewSession ? [] : payload.conversationHistory,
    {
      appName: payload.appName,
      gatewayUsername: payload.gatewayUsername,
      requestedSessionId: shouldForceRequestedSession ? requestedSessionId : undefined,
      forceRequestedSessionId: shouldForceRequestedSession,
    }
  )

  let message = parsed.message
  let usedDefaultModelBootstrap = false

  if (!session.modelInitialized && payload.defaultAgentModel?.trim()) {
    const normalizedModel = payload.defaultAgentModel.trim()
    message = parsed.message.length > 0 ? `/new ${normalizedModel} ${parsed.message}` : `/new ${normalizedModel}`
    usedDefaultModelBootstrap = true
  }

  return {
    message,
    conversationHistory: session.conversation,
    sessionId: session.id,
    usedDefaultModelBootstrap,
  }
}

const resolveResponseSessionId = (candidate: string, fallback: string) => {
  const parsed = chatSessionIdSchema.safeParse(candidate)
  return parsed.success ? parsed.data : fallback
}

const resolveGatewayError = (error: unknown) => {
  if (error instanceof GatewayClientError) {
    return {
      status: error.code === "timeout" ? 504 : 502,
      payload: {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    }
  }

  return {
    status: 500,
    payload: {
      error: error instanceof Error ? error.message : "Unexpected error",
      code: "server_error",
    },
  }
}

const normalizeMessageContent = (value: string) => value.trim()

const fallbackAssistantText = "I am sorry, I could not generate a response."

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

  let sessionContext
  let sessionLocked = false

  try {
    sessionContext = await resolveSessionContext({
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
    sessionLocked = true

    const normalizedUserMessage = normalizeMessageContent(sessionContext.message)
    if (!normalizedUserMessage.length) {
      return buildJsonResponse(request, 400, {
        error: "Message must not be empty",
        code: "invalid_message",
      })
    }

    const result = await chatWithGateway({
      gatewayUrl: env.OPENCLAW_GATEWAY_URL,
      gatewayToken: env.OPENCLAW_GATEWAY_TOKEN,
      agentId: env.OPENCLAW_AGENT_ID,
      conversationId: sessionContext.sessionId,
      text: normalizedUserMessage,
      timeoutMs: env.OPENCLAW_CHAT_REQUEST_TIMEOUT_MS,
      maxRetryAttempts: env.OPENCLAW_GATEWAY_MAX_RETRY_ATTEMPTS,
    })
    const responseSessionId = resolveResponseSessionId(result.conversationId, sessionContext.sessionId)
    const normalizedAssistantMessage = normalizeMessageContent(result.text) || fallbackAssistantText

    const nextConversationHistory = [
      ...sessionContext.conversationHistory,
      {
        role: "user",
        content: normalizedUserMessage,
      },
      {
        role: "assistant",
        content: normalizedAssistantMessage,
      },
    ]

    try {
      await appendToSessionConversation(sessionContext.sessionId, [
        {
          role: "user",
          content: normalizedUserMessage,
        },
        {
          role: "assistant",
          content: normalizedAssistantMessage,
        },
      ])
    } catch (error) {
      logger.warn(
        `[${CHAT_OPERATION}] unable to persist chat turn for session ${sessionContext.sessionId}: ${getErrorMessage(
          error
        )}`
      )
    }

    if (sessionContext.usedDefaultModelBootstrap) {
      try {
        await setSessionModelInitialized(sessionContext.sessionId)
      } catch (error) {
        logger.warn(
          `[${CHAT_OPERATION}] unable to persist model bootstrap state for session ${sessionContext.sessionId}: ${getErrorMessage(
            error
          )}`
        )
      }
    }

    const responsePayload = chatResponseSchema.parse({
      text: normalizedAssistantMessage,
      conversationHistory: nextConversationHistory,
      sessionId: responseSessionId,
    })

    logger.info(`[${CHAT_OPERATION}] completed chat for session: ${responsePayload.sessionId}`)
    return buildJsonResponse(request, 200, responsePayload)
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code) {
      const code = (error as { code?: string }).code
      const message = (error as { message?: string }).message

      if (code === "concurrency_error") {
        return buildJsonResponse(request, 503, {
          error: "Concurrency limit reached",
          code,
          message: message || "Maximum concurrent work in progress",
          retryable: true,
          retryAfterMs: 1000,
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

    const mapped = resolveGatewayError(error)
    logger.error(`Chat route error: ${getErrorMessage(error)}`)
    return buildJsonResponse(request, mapped.status, mapped.payload)
  } finally {
    if (sessionLocked && sessionContext?.sessionId) {
      await releaseSessionJobSlot(sessionContext.sessionId)
    }
  }
}
