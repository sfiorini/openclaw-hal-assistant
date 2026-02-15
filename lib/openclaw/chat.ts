import { z } from "zod"

import { isTimeoutError, withTimeout } from "../middleware/timeout"
import type { ChatJobErrorCode, ChatMessage, ChatJobError, ChatJobResponse } from "../chat/jobs"

const HAL_SYSTEM_PROMPT =
  "You are HAL 9000, the advanced AI from 2001: A Space Odyssey. You speak in a calm, measured, and polite tone. You are helpful, knowledgeable, and always precise. Keep your responses concise and conversational since they will be spoken aloud. Do not use markdown formatting, code blocks, or special characters in your responses."

const normalizeGatewayBaseUrl = (value: string) => {
  const withoutTrailingSlash = value
    .trim()
    .replace(/^ws:/, "http:")
    .replace(/^wss:/, "https:")
    .replace(/\/+$/, "")
  if (withoutTrailingSlash.toLowerCase().endsWith("/v1")) {
    return withoutTrailingSlash.slice(0, -3)
  }
  return withoutTrailingSlash
}

const buildGatewayUrl = (gatewayUrl: string, path: string) => {
  const base = normalizeGatewayBaseUrl(gatewayUrl)
  return `${base}/v1${path}`
}

const openClawChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.enum(["assistant", "system", "user"]),
        content: z.string(),
      }),
    })
  ),
  usage: z
    .object({
      total_tokens: z.number().nonnegative().optional(),
    })
    .optional(),
})

export const mapOpenClawError = (error: unknown): ChatJobError => {
  if (error instanceof OpenClawChatError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    }
  }

  if (isTimeoutError(error)) {
    return {
      code: "timeout",
      message: "Upstream request timed out",
    }
  }

  if (error instanceof Error) {
    return {
      code: "server_error",
      message: error.message,
    }
  }

  return {
    code: "server_error",
    message: "Unexpected upstream failure",
  }
}

export class OpenClawChatError extends Error {
  constructor(
    public code: ChatJobErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "OpenClawChatError"
  }
}

export const chatWithOpenClaw = async (
  params: {
    message: string
    conversationHistory: ChatMessage[]
    gatewayUrl: string
    gatewayToken: string
    agentId: string
  },
  timeoutMs = 120_000
): Promise<ChatJobResponse> => {
  const messages = [
    {
      role: "system" as const,
      content: HAL_SYSTEM_PROMPT,
    },
    ...params.conversationHistory,
    { role: "user" as const, content: params.message },
  ]

  const chatUrl = buildGatewayUrl(params.gatewayUrl, "/chat/completions")

  try {
    const response = await withTimeout(
      (signal) =>
        fetch(chatUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.gatewayToken}`,
          },
          body: JSON.stringify({
            model: params.agentId,
            messages,
            temperature: 0.7,
            max_tokens: 500,
          }),
          signal,
        }),
      timeoutMs
    )

    if (!response.ok) {
      const upstreamMessage = await response.text().catch(() => "OpenClaw request failed")
      throw new OpenClawChatError(
        "upstream_error",
        upstreamMessage || "OpenClaw request failed",
        { status: response.status, url: chatUrl }
      )
    }

    const payload = await response.json()
    const parsed = openClawChatResponseSchema.parse(payload)
    const assistantMessage = parsed.choices[0]?.message?.content?.trim()

    if (!assistantMessage) {
      throw new OpenClawChatError(
        "validation_error",
        "OpenClaw response missing assistant message"
      )
    }

    return {
      text: assistantMessage,
      conversationHistory: [
        ...params.conversationHistory,
        { role: "user", content: params.message },
        { role: "assistant", content: assistantMessage },
      ],
    }
  } catch (error) {
    const mapped = mapOpenClawError(error)
    if (error instanceof OpenClawChatError) {
      throw error
    }
    throw new OpenClawChatError(mapped.code, mapped.message, mapped.details)
  }
}
