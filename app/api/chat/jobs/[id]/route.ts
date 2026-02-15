import { NextRequest, NextResponse } from "next/server"

import { applyCorsHeaders, corsPreflightResponse } from "../../../../../lib/middleware/cors"
import { createLogger } from "../../../../../lib/middleware/logger"
import { limitRequest } from "../../../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../../../lib/middleware/auth"
import { getServerEnvConfig } from "../../../../../lib/config/env"
import { cancelChatJob, getChatJobById, readChatJobForPolling } from "../../../../../lib/chat/jobs"

const logger = createLogger()
const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error")

const buildJsonResponse = (request: NextRequest, status: number, body: Record<string, unknown>) =>
  applyCorsHeaders(
    NextResponse.json(body, {
      status,
    }),
    request
  )

const buildTerminalResponse = (
  jobId: string,
  state: NonNullable<ReturnType<typeof getChatJobById>>
) => {
  return {
    jobId,
    status: state.status,
    createdAt: state.createdAt,
    pollAfterMs: 0,
    attemptCount: state.attemptCount ?? 0,
    progress: state.progress,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    response: state.response,
    error: state.error,
  }
}

const buildPollingResponse = (
  state: NonNullable<ReturnType<typeof getChatJobById>>,
  pollState: NonNullable<ReturnType<typeof readChatJobForPolling>>
) => ({
  jobId: pollState.jobId,
  status: pollState.status,
  pollAfterMs: pollState.pollAfterMs ?? 1000,
  attemptCount: pollState.attemptCount ?? 0,
  progress: pollState.progress,
  createdAt: state.createdAt,
  startedAt: pollState.startedAt,
  finishedAt: pollState.finishedAt,
  response: pollState.response,
  error: pollState.error,
})

const buildCancelledAlreadyResponse = (state: NonNullable<ReturnType<typeof getChatJobById>>) =>
  buildTerminalResponse(state.id, state)

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request)
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
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

  const resolvedParams = await Promise.resolve(params)
  const state = getChatJobById(resolvedParams.id)
  if (!state) {
    return buildJsonResponse(request, 404, { error: "Job not found" })
  }

  const pollState = readChatJobForPolling(resolvedParams.id)
  if (!pollState) {
    return buildJsonResponse(request, 404, { error: "Job disappeared" })
  }

  const isTerminal = ["completed", "failed", "cancelled"].includes(state.status)
  const response = isTerminal
    ? buildTerminalResponse(resolvedParams.id, state)
    : buildPollingResponse(state, pollState)

  logger.debug(
    `[chat.get] jobId=${resolvedParams.id} status=${state.status} attempts=${response.attemptCount}`
  )

  return buildJsonResponse(request, 200, response)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
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

  const resolvedParams = await Promise.resolve(params)
  const existing = getChatJobById(resolvedParams.id)
  if (!existing) {
    return buildJsonResponse(request, 404, { error: "Job not found" })
  }

  if (existing.status === "completed" || existing.status === "failed") {
    return buildJsonResponse(request, 409, {
      error: "Terminal job cannot be cancelled",
      code: "validation_error",
    })
  }

  if (existing.status === "cancelled") {
    return buildJsonResponse(request, 200, buildCancelledAlreadyResponse(existing))
  }

  const cancelled = cancelChatJob(resolvedParams.id)
  if (!cancelled) {
    return buildJsonResponse(request, 404, { error: "Job not found" })
  }

  return buildJsonResponse(request, 200, {
    jobId: cancelled.id,
    status: "cancelled",
    pollAfterMs: 0,
    createdAt: cancelled.createdAt,
    attemptCount: cancelled.attemptCount ?? 0,
    progress: cancelled.progress,
    finishedAt: cancelled.finishedAt,
    error: cancelled.error,
  })
}
