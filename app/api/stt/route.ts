import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"

import { applyCorsHeaders, corsPreflightResponse } from "../../../lib/middleware/cors"
import { createLogger } from "../../../lib/middleware/logger"
import { limitRequest } from "../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../lib/middleware/auth"
import { isTimeoutError, withTimeout } from "../../../lib/middleware/timeout"
import { sttRequestSchema, sttResponseSchema } from "../../../lib/schemas/stt.schema"
import { getServerEnvConfig } from "../../../lib/config/env"

const logger = createLogger()

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

export async function POST(request: NextRequest) {
  let env

  try {
    env = getServerEnvConfig()
  } catch (error) {
    return buildErrorResponse(
      request,
      500,
      { error: (error as Error).message }
    )
  }

  const authResponse = await withApiKeyAuth(request, {
    requiredApiKey: env.OPENCLAW_API_KEY,
  })
  if (authResponse) {
    return buildErrorResponse(request, 401, await authResponse.json())
  }

  const rateLimitResponse = limitRequest(request, env.OPENCLAW_RATE_LIMIT)
  if (rateLimitResponse) {
    return applyCorsHeaders(rateLimitResponse, request)
  }

  let validatedAudio
  try {
    const formData = await request.formData()
    const audio = formData.get("audio")
    validatedAudio = sttRequestSchema.parse({ audio }).audio
  } catch (error) {
    if (error instanceof ZodError) {
      return buildErrorResponse(request, 400, {
        error: "Invalid request",
        details: error.errors.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      })
    }

    logger.error(`STT request validation error: ${(error as Error).message}`)
    return buildErrorResponse(request, 400, { error: "Invalid request" })
  }

  const elevenLabsForm = new FormData()
  elevenLabsForm.append("file", validatedAudio)
  elevenLabsForm.append("model_id", "scribe_v1")

  try {
    const response = await withTimeout(
      (signal) =>
        fetch("https://api.elevenlabs.io/v1/speech-to-text", {
          method: "POST",
          headers: {
            "xi-api-key": env.ELEVENLABS_API_KEY,
          },
          body: elevenLabsForm,
          signal,
        }),
      10_000
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`STT upstream error: ${errorText}`)
      return buildErrorResponse(request, 502, { error: "Speech-to-text conversion failed" })
    }

    const data = await response.json()
    let output
    try {
      output = sttResponseSchema.parse({ text: data.text })
    } catch (error) {
      logger.error(`STT response validation error: ${(error as Error).message}`)
      return buildErrorResponse(request, 502, {
        error: "Invalid response from speech-to-text service",
      })
    }

    return buildErrorResponse(request, 200, output)
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.error(`STT request timed out: ${error.message}`)
      return buildErrorResponse(request, 504, { error: "Speech-to-text conversion timed out" })
    }

    logger.error(`STT route error: ${(error as Error).message}`)
    return buildErrorResponse(request, 500, {
      error: "Internal server error",
    })
  }
}
