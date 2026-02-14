import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"

import { applyCorsHeaders, corsPreflightResponse } from "../../../lib/middleware/cors"
import { createLogger } from "../../../lib/middleware/logger"
import { limitRequest } from "../../../lib/middleware/rate-limit"
import { withApiKeyAuth } from "../../../lib/middleware/auth"
import { isTimeoutError, withTimeout } from "../../../lib/middleware/timeout"
import { chatRequestSchema, chatResponseSchema } from "../../../lib/schemas/chat.schema"
import { getServerEnvConfig } from "../../../lib/config/env"

const logger = createLogger()
const FALLBACK_TEXT = "I'm sorry, I could not generate a response."

const HAL_SYSTEM_PROMPT =
  "You are HAL 9000, the advanced AI from 2001: A Space Odyssey. You speak in a calm, measured, and polite tone. You are helpful, knowledgeable, and always precise. Keep your responses concise and conversational since they will be spoken aloud. Do not use markdown formatting, code blocks, or special characters in your responses."

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

  let payload
  try {
    payload = chatRequestSchema.parse(await request.json())
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

    logger.error(`Chat request validation error: ${(error as Error).message}`)
    return buildErrorResponse(request, 400, { error: "Invalid request" })
  }

  const messages = [
    {
      role: "system" as const,
      content: HAL_SYSTEM_PROMPT,
    },
    ...payload.conversationHistory,
    { role: "user" as const, content: payload.message },
  ]

  try {
    const response = await withTimeout(
      (signal) =>
        fetch(`${env.OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENCLAW_GATEWAY_TOKEN}`,
          },
          body: JSON.stringify({
            model: env.OPENCLAW_AGENT_ID,
            messages,
            temperature: 0.7,
            max_tokens: 500,
          }),
          signal,
        }),
      45_000
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`OpenClaw gateway error: ${errorText}`)
      return buildErrorResponse(request, 502, { error: "Chat completion failed" })
    }

    const data = await response.json()
    const assistantMessage =
      typeof data.choices?.[0]?.message?.content === "string"
        ? data.choices?.[0]?.message?.content
        : FALLBACK_TEXT

    let output
    try {
      output = chatResponseSchema.parse({
        text: assistantMessage,
        conversationHistory: [
          ...payload.conversationHistory,
          { role: "user", content: payload.message },
          { role: "assistant", content: assistantMessage },
        ],
      })
    } catch (error) {
      logger.error(`Chat response validation error: ${(error as Error).message}`)
      return buildErrorResponse(request, 502, {
        error: "Invalid response from chat service",
      })
    }

    return buildErrorResponse(request, 200, output)
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.error(`Chat request timed out: ${error.message}`)
      return buildErrorResponse(request, 504, { error: "Chat completion timed out" })
    }

    logger.error(`Chat route error: ${(error as Error).message}`)
    return buildErrorResponse(request, 500, {
      error: "Internal server error",
    })
  }
}
