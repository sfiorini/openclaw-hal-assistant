import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"

import { applyCorsHeaders, corsPreflightResponse } from "../../../lib/middleware/cors"
import { createLogger } from "../../../lib/middleware/logger"
import { limitRequest } from "../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../lib/middleware/auth"
import { isTimeoutError, withTimeout } from "../../../lib/middleware/timeout"
import { ttsRequestSchema } from "../../../lib/schemas/tts.schema"
import { getServerEnvConfig } from "../../../lib/config/env"

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

export async function POST(request: NextRequest) {
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

  const rateLimitResponse = limitRequest(request, env.OPENCLAW_RATE_LIMIT)
  if (rateLimitResponse) {
    return applyCorsHeaders(rateLimitResponse, request)
  }

  try {
    const { text } = ttsRequestSchema.parse(await request.json())

    const response = await withTimeout(
      (signal) =>
        fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`, {
          method: "POST",
          headers: {
            "xi-api-key": env.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.75,
              similarity_boost: 0.85,
              style: 0.1,
              use_speaker_boost: true,
            },
          }),
          signal,
        }),
      20_000
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`TTS upstream error: ${errorText}`)
      return buildErrorResponse(request, 502, { error: "Text-to-speech conversion failed" })
    }

    const audioBuffer = await response.arrayBuffer()
    const output = new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    })

    return applyCorsHeaders(output, request)
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.error(`TTS request timed out: ${getErrorMessage(error)}`)
      return buildErrorResponse(request, 504, { error: "Text-to-speech conversion timed out" })
    }

    if (error instanceof ZodError) {
      return buildErrorResponse(request, 400, {
        error: "Invalid request",
        details: error.errors.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      })
    }

    logger.error(`TTS route error: ${getErrorMessage(error)}`)
    return buildErrorResponse(request, 500, {
      error: "Internal server error",
    })
  }
}
