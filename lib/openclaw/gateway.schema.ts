import { z } from "zod"

const trimmedText = z.string().trim().min(1)

const incomingFrameBase = z.object({
  id: trimmedText.optional(),
  type: z.union([z.literal("req"), z.literal("res"), z.literal("event")]),
}).passthrough()

const outgoingFrameBase = z.object({
  id: trimmedText,
  type: z.literal("req"),
})

const responsePayloadSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  details: z.record(z.unknown()).optional(),
})

export const gatewayConnectRequestSchema = outgoingFrameBase.extend({
  method: z.literal("connect"),
  params: z.object({
    minProtocol: z.number().int().min(1),
    maxProtocol: z.number().int().min(1),
    client: z.object({
      id: trimmedText,
      version: trimmedText,
      platform: trimmedText,
      mode: trimmedText,
    }),
    auth: z.object({
      token: trimmedText,
    }),
    role: trimmedText.optional(),
    scopes: z.array(trimmedText).optional(),
    caps: z.array(trimmedText).optional(),
    commands: z.array(trimmedText).optional(),
    permissions: z.record(z.unknown()).optional(),
    locale: trimmedText.optional(),
    userAgent: trimmedText.optional(),
    deviceId: trimmedText.optional(),
  }).passthrough(),
})

export const gatewayConnectRespondSchema = outgoingFrameBase.extend({
  method: z.literal("connect.respond"),
  params: z.object({
    response: trimmedText.optional(),
    nonce: trimmedText.optional(),
    signature: trimmedText.optional(),
  }).passthrough(),
})

export const gatewayConnectedEventSchema = incomingFrameBase.extend({
  type: z.literal("event"),
  event: z.union([z.literal("connected"), z.literal("connect.success")]),
  payload: z
    .object({
      sessionId: trimmedText.optional(),
      expiresAt: z.string().optional(),
    })
    .optional(),
})

export const gatewayConnectChallengeSchema = incomingFrameBase.extend({
  type: z.literal("event"),
  event: z.literal("connect.challenge"),
  payload: z.object({
    nonce: trimmedText,
    ts: z.number().int().optional(),
  }).passthrough(),
})

export const gatewayChatSendRequestSchema = outgoingFrameBase.extend({
  method: z.literal("chat.send"),
  params: z.object({
    sessionKey: trimmedText,
    message: trimmedText,
    idempotencyKey: trimmedText,
    metadata: z.record(z.unknown()).optional(),
  }).passthrough(),
})

export const gatewayAgentWaitRequestSchema = outgoingFrameBase.extend({
  method: z.literal("agent.wait"),
  params: z.object({
    runId: trimmedText,
  }).passthrough(),
})

export const gatewayChatTokenEventSchema = incomingFrameBase.extend({
  type: z.literal("event"),
  event: z.literal("chat.token"),
  payload: z.object({
    token: z.string(),
    tokenIndex: z.number().int().nonnegative().optional(),
  }),
})

export const gatewayChatCompleteEventSchema = incomingFrameBase.extend({
  type: z.literal("event"),
  event: z.literal("chat.complete"),
  payload: z.object({
    text: z.string(),
    conversationId: trimmedText.optional(),
  }).passthrough(),
})

export const gatewayAgentEventSchema = incomingFrameBase.extend({
  type: z.literal("event"),
  event: z.literal("agent"),
  payload: z.object({
    runId: trimmedText,
    stream: trimmedText.optional(),
    data: z.record(z.unknown()).optional(),
    sessionKey: trimmedText.optional(),
  }).passthrough(),
})

export const gatewayChatEventSchema = incomingFrameBase.extend({
  type: z.literal("event"),
  event: z.literal("chat"),
  payload: z.object({
    runId: trimmedText.optional(),
    state: trimmedText.optional(),
    sessionKey: trimmedText.optional(),
    message: z.object({
      role: trimmedText.optional(),
      content: z.array(
        z.object({
          type: trimmedText.optional(),
          text: z.string().optional(),
        }).passthrough()
      ).optional(),
    }).passthrough().optional(),
  }).passthrough(),
})

export const gatewayErrorEventSchema = incomingFrameBase.extend({
  type: z.literal("event"),
  event: z.literal("error"),
  payload: responsePayloadSchema,
})

export const gatewayResponseSchema = incomingFrameBase
  .omit({ type: true })
  .extend({
    type: z.literal("res"),
    ok: z.boolean().optional(),
    method: z.string().trim().min(1).optional(),
    payload: z.unknown().optional(),
    result: z.unknown().optional(),
    error: responsePayloadSchema.optional(),
  })
  .passthrough()

export const gatewayUnknownIncomingMessageSchema = incomingFrameBase
  .extend({
    payload: z.unknown().optional(),
    params: z.unknown().optional(),
  })
  .passthrough()

export const gatewayIncomingMessageSchema = z.union([
  gatewayConnectedEventSchema,
  gatewayConnectChallengeSchema,
  gatewayAgentEventSchema,
  gatewayChatEventSchema,
  gatewayChatTokenEventSchema,
  gatewayChatCompleteEventSchema,
  gatewayErrorEventSchema,
  gatewayResponseSchema,
  gatewayUnknownIncomingMessageSchema,
])

export const gatewayOutgoingMessageSchema = z.union([
  gatewayConnectRequestSchema,
  gatewayConnectRespondSchema,
  gatewayChatSendRequestSchema,
  gatewayAgentWaitRequestSchema,
])

export type GatewayConnectRequest = z.infer<typeof gatewayConnectRequestSchema>
export type GatewayConnectRespondRequest = z.infer<typeof gatewayConnectRespondSchema>
export type GatewayConnectedEvent = z.infer<typeof gatewayConnectedEventSchema>
export type GatewayConnectChallengeEvent = z.infer<typeof gatewayConnectChallengeSchema>
export type GatewayChatSendRequest = z.infer<typeof gatewayChatSendRequestSchema>
export type GatewayAgentWaitRequest = z.infer<typeof gatewayAgentWaitRequestSchema>
export type GatewayChatTokenEvent = z.infer<typeof gatewayChatTokenEventSchema>
export type GatewayChatCompleteEvent = z.infer<typeof gatewayChatCompleteEventSchema>
export type GatewayAgentEvent = z.infer<typeof gatewayAgentEventSchema>
export type GatewayChatEvent = z.infer<typeof gatewayChatEventSchema>
export type GatewayErrorEvent = z.infer<typeof gatewayErrorEventSchema>
export type GatewayResponse = z.infer<typeof gatewayResponseSchema>
export type GatewayIncomingMessage = z.infer<typeof gatewayIncomingMessageSchema>
export type GatewayOutgoingMessage = z.infer<typeof gatewayOutgoingMessageSchema>
