import { NextRequest, NextResponse } from "next/server"

import { applyCorsHeaders, corsPreflightResponse } from "../../../../lib/middleware/cors"
import { createLogger } from "../../../../lib/middleware/logger"
import { limitRequest } from "../../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../../lib/middleware/auth"
import { getServerEnvConfig } from "../../../../lib/config/env"
import { listChatJobs } from "../../../../lib/chat/jobs"
import { chatJobListSchema } from "@/lib/schemas/chat.schema"

const logger = createLogger()
const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error")

const buildErrorResponse = (request: NextRequest, status: number, body: Record<string, unknown>) =>
  applyCorsHeaders(
    NextResponse.json(body, {
      status,
    }),
    request
  )

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request)
}

export async function GET(request: NextRequest) {
  let env
  try {
    env = getServerEnvConfig()
  } catch (error) {
    return buildErrorResponse(request, 500, { error: getErrorMessage(error) })
  }

  const authResponse = await withApiKeyAuth(request, {
    requiredApiKey: env.OPENCLAW_API_KEY,
  })
  if (authResponse) {
    return buildErrorResponse(request, 401, await authResponse.json())
  }

  const rateLimitResponse = limitRequest(request, Math.max(env.OPENCLAW_RATE_LIMIT, 200))
  if (rateLimitResponse) {
    return applyCorsHeaders(rateLimitResponse, request)
  }

  const jobs = listChatJobs().map((job) => ({
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
  }))

  const response = chatJobListSchema.parse({
    jobs,
    nextCursor: jobs.length > 0 ? `job-created-at:${Date.now()}` : null,
  })

  logger.debug(`chat.jobs debug list requested count=${jobs.length}`)
  return buildErrorResponse(request, 200, response)
}
