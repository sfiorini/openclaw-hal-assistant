import "./openapi"
import { z } from "zod"

import { chatSessionIdSchema } from "@/lib/chat/schemas/session.schema"

const chatRoleSchema = z
  .enum(["user", "assistant"], {
    invalid_type_error: "role must be a string",
    required_error: "role is required",
  })
  .openapi({
    description: "Conversation message role.",
    example: "user",
  })

export const chatMessageSchema = z
  .object({
    role: chatRoleSchema,
    content: z
      .string({
        required_error: "content is required",
        invalid_type_error: "content must be a string",
      })
      .trim()
      .min(1, "content must not be empty"),
  })
  .openapi({
    title: "ChatMessage",
    description: "Single message in the chat payload.",
  })

export const chatRequestSchema = z
  .object({
    message: z
      .string({
        required_error: "message is required",
      })
      .trim()
      .min(1, "message is required")
      .max(4000, "message must not exceed 4000 characters"),
    sessionId: chatSessionIdSchema.optional(),
    newSession: z.boolean().optional().default(false),
    conversationHistory: z
      .array(chatMessageSchema, {
        required_error: "conversationHistory must be an array",
      })
      .max(20, "conversationHistory must not exceed 20 messages")
      .optional()
      .default([]),
  })
  .openapi({
    title: "ChatRequest",
    description: "Payload for chat completion.",
  })

export const chatResponseSchema = z
  .object({
    text: z
      .string({
        required_error: "text is required",
      })
      .min(1, "text must not be empty"),
    conversationHistory: z
      .array(chatMessageSchema)
      .default([]),
    sessionId: chatSessionIdSchema,
  })
  .openapi({
    title: "ChatResponse",
    description: "Generated chat assistant response and updated history.",
  })
