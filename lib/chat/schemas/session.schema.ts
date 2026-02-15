import { z } from "zod"

const SESSION_COMMAND_RE = /^(\/new|\/reset)(?:\s+(.*))?$/u

export const chatSessionIdSchema = z
  .string({
    required_error: "sessionId is required",
    invalid_type_error: "sessionId must be a string",
  })
  .trim()
  .uuid("sessionId must be a valid UUID")

export type ParsedSessionCommand = {
  message: string
  newSession: boolean
  command: string | null
}

export const parseChatSessionCommand = (value: string): ParsedSessionCommand => {
  const trimmed = value.trim()
  const match = SESSION_COMMAND_RE.exec(trimmed)
  if (!match) {
    return {
      message: trimmed,
      newSession: false,
      command: null,
    }
  }

  const command = match[1]
  const remaining = (match[2] ?? "").trim()

  return {
    message: remaining,
    newSession: true,
    command,
  }
}

export const chatSessionRequestSchema = z
  .object({
    sessionId: chatSessionIdSchema.optional(),
    newSession: z.boolean().default(false),
  })
  .partial()
  .passthrough()
