import "./openapi"
import { z } from "zod"

import type { ChatJobErrorCode, ChatJobStatus } from "@/lib/chat/jobs"

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
      .min(0, "message is required")
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
    text: z.string({
      required_error: "text is required",
    }),
    conversationHistory: z
      .array(chatMessageSchema)
      .default([]),
  })
  .openapi({
    title: "ChatResponse",
    description: "Generated chat assistant response and updated history.",
  })

export const chatJobErrorCodeSchema = z
  .enum([
    "validation_error",
    "idempotency_conflict",
    "upstream_error",
    "tool_error",
    "cancelled",
    "timeout",
    "concurrency_error",
    "server_error",
  ] as const)
  .openapi({
    title: "ChatJobErrorCode",
    description: "Classified upstream/job failure code.",
  })

export const chatJobErrorSchema = z
  .object({
    code: chatJobErrorCodeSchema,
    message: z
      .string({
        required_error: "error message is required",
      })
      .trim()
      .min(1, "error message is required"),
    details: z.record(z.unknown()).optional(),
  })
  .openapi({
    title: "ChatJobError",
    description: "Machine-readable job failure details.",
  })

export const chatJobProgressSchema = z
  .enum([
    "accepted",
    "dispatching_to_openclaw",
    "waiting_for_upstream",
    "tool_execution",
    "finalizing",
    "awaiting_client_poll",
    "cancel_pending",
  ])
  .openapi({
    title: "ChatJobProgress",
    description: "Progress marker for long-running chat jobs.",
  })

export const chatJobRequestSchema = z
  .object({
    message: z
      .string({
        required_error: "message is required",
      })
      .trim()
      .min(0, "message is required")
      .max(4000, "message must not exceed 4000 characters"),
    sessionId: chatSessionIdSchema.optional(),
    newSession: z.boolean().optional().default(false),
    conversationHistory: z
      .array(chatMessageSchema, {
        required_error: "conversationHistory must be an array",
      })
      .max(20, "conversationHistory must not exceed 20 messages")
      .default([]),
  })
  .openapi({
    title: "ChatJobRequest",
    description: "Payload for async chat job submission.",
  })

export const chatJobSubmissionResponseSchema = z
  .object({
    sessionId: chatSessionIdSchema,
    jobId: z.string().uuid("jobId must be a valid UUID"),
    status: z
      .enum(["queued"] as const)
      .openapi({
        description: "Initial status for asynchronous chat submission.",
      }),
    pollAfterMs: z.number().nonnegative(),
    maxPollAttempts: z.number().int().positive(),
    maxWaitMs: z.number().int().positive(),
  })
  .openapi({
    title: "ChatJobSubmissionResponse",
    description: "Accepted chat job descriptor.",
  })

export const chatJobBaseResponseSchema = z
  .object({
    sessionId: chatSessionIdSchema,
    jobId: z.string().uuid("jobId must be a valid UUID"),
    status: z.enum([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
    ] as const),
    pollAfterMs: z.number().nonnegative(),
    progress: chatJobProgressSchema.optional(),
    attemptCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
  })

export const chatJobQueuedSchema = chatJobBaseResponseSchema.extend({
  status: z.enum(["queued"] as const),
}).openapi({
  title: "ChatJobQueued",
  description: "Polling response while queued.",
})

export const chatJobRunningSchema = chatJobBaseResponseSchema.extend({
  status: z.enum(["running"] as const),
}).openapi({
  title: "ChatJobRunning",
  description: "Polling response while running.",
})

export const chatJobCompletedSchema = chatJobBaseResponseSchema.extend({
  status: z.enum(["completed"] as const),
  response: chatResponseSchema,
}).openapi({
  title: "ChatJobCompleted",
  description: "Terminal completed job state.",
})

export const chatJobFailedSchema = chatJobBaseResponseSchema.extend({
  status: z.enum(["failed"] as const),
  error: chatJobErrorSchema,
}).openapi({
  title: "ChatJobFailed",
  description: "Terminal failed job state.",
})

export const chatJobCancelledSchema = chatJobBaseResponseSchema.extend({
  status: z.enum(["cancelled"] as const),
  error: chatJobErrorSchema,
}).openapi({
  title: "ChatJobCancelled",
  description: "Terminal cancelled job state.",
})

export const chatJobDebugItemSchema = z.object({
  jobId: z.string().uuid("jobId must be a valid UUID"),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"] as const),
  createdAt: z.string().datetime(),
})

export const chatJobListSchema = z
  .object({
    jobs: z.array(chatJobDebugItemSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi({
    title: "ChatJobListResponse",
    description: "Debug endpoint list of in-memory chat jobs.",
  })

export const chatJobStatusSchema = chatJobQueuedSchema
  .or(chatJobRunningSchema)
  .or(chatJobCompletedSchema)
  .or(chatJobFailedSchema)
  .or(chatJobCancelledSchema)
  .openapi({
    title: "ChatJobStatusResponse",
    description: "Polling response for chat jobs.",
  })

export type ChatJobStatusType = z.infer<typeof chatJobBaseResponseSchema> & {
  status: ChatJobStatus
}

export type ChatJobErrorCodeType = ChatJobErrorCode
