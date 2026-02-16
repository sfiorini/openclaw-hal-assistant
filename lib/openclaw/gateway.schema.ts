import { z } from "zod"

const trimmedText = z.string().trim().min(1)

const incomingFrameBase = z.object({
  id: trimmedText.optional(),
  type: z.union([z.literal("req"), z.literal("res"), z.literal("event")]),
})

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
    token: trimmedText,
    deviceId: trimmedText.optional(),
  }),
})

export const gatewayConnectRespondSchema = outgoingFrameBase.extend({
  method: z.literal("connect.respond"),
  params: z.object({
    response: trimmedText,
  }),
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
    challenge: trimmedText,
    expiresAt: z.string().datetime().optional(),
  }),
})

export const gatewayChatSendRequestSchema = outgoingFrameBase.extend({
  method: z.literal("chat.send"),
  params: z.object({
    text: trimmedText,
    conversationId: trimmedText.optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
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
    conversationId: trimmedText,
  }),
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
    method: z.string().trim().min(1),
    result: z.unknown().optional(),
    error: responsePayloadSchema.optional(),
  })

export const gatewayUnknownIncomingMessageSchema = incomingFrameBase
  .extend({
    payload: z.unknown().optional(),
    params: z.unknown().optional(),
  })
  .passthrough()

export const gatewayIncomingMessageSchema = z.union([
  gatewayConnectedEventSchema,
  gatewayConnectChallengeSchema,
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
])

export type GatewayConnectRequest = z.infer<typeof gatewayConnectRequestSchema>
export type GatewayConnectRespondRequest = z.infer<typeof gatewayConnectRespondSchema>
export type GatewayConnectedEvent = z.infer<typeof gatewayConnectedEventSchema>
export type GatewayConnectChallengeEvent = z.infer<typeof gatewayConnectChallengeSchema>
export type GatewayChatSendRequest = z.infer<typeof gatewayChatSendRequestSchema>
export type GatewayChatTokenEvent = z.infer<typeof gatewayChatTokenEventSchema>
export type GatewayChatCompleteEvent = z.infer<typeof gatewayChatCompleteEventSchema>
export type GatewayErrorEvent = z.infer<typeof gatewayErrorEventSchema>
export type GatewayResponse = z.infer<typeof gatewayResponseSchema>
export type GatewayIncomingMessage = z.infer<typeof gatewayIncomingMessageSchema>
export type GatewayOutgoingMessage = z.infer<typeof gatewayOutgoingMessageSchema>
