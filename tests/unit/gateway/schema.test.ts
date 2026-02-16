import { describe, expect, it } from "vitest"

import {
  gatewayChatCompleteEventSchema,
  gatewayChatSendRequestSchema,
  gatewayConnectChallengeSchema,
  gatewayConnectRequestSchema,
  gatewayConnectRespondSchema,
  gatewayErrorEventSchema,
  gatewayIncomingMessageSchema,
  gatewayOutgoingMessageSchema,
} from "../../../lib/openclaw/gateway.schema"

describe("gateway schemas", () => {
  it("validates connect request payload", () => {
    const parsed = gatewayConnectRequestSchema.parse({
      id: "connect-1",
      type: "req",
      method: "connect",
      params: {
        token: "gateway-token",
        deviceId: "device-123",
      },
    })

    expect(parsed.params.token).toBe("gateway-token")
    expect(parsed.params.deviceId).toBe("device-123")
  })

  it("validates connect.challenge payload with optional expiry", () => {
    const parsed = gatewayConnectChallengeSchema.parse({
      id: "connect-1",
      type: "event",
      event: "connect.challenge",
      payload: {
        challenge: "abc",
        expiresAt: "2025-10-01T00:00:00.000Z",
      },
    })

    expect(parsed.event).toBe("connect.challenge")
  })

  it("validates connect.respond payload", () => {
    const parsed = gatewayConnectRespondSchema.parse({
      id: "connect-2",
      type: "req",
      method: "connect.respond",
      params: { response: "signed-token" },
    })

    expect(parsed.params.response).toBe("signed-token")
  })

  it("validates chat.send request and allows optional conversationId", () => {
    const parsed = gatewayChatSendRequestSchema.parse({
      id: "chat-1",
      type: "req",
      method: "chat.send",
      params: {
        text: "Say hello",
        conversationId: "conv-1",
      },
    })

    expect(parsed.params.text).toBe("Say hello")
    expect(parsed.params.conversationId).toBe("conv-1")
  })

  it("validates chat.complete and protocol error frames", () => {
    expect(
      gatewayChatCompleteEventSchema.parse({
        id: "chat-2",
        type: "event",
        event: "chat.complete",
        payload: { text: "Hi", conversationId: "conv-1" },
      })
    ).toMatchObject({ payload: { text: "Hi" } })

    expect(
      gatewayErrorEventSchema.parse({
        id: "chat-2",
        type: "event",
        event: "error",
        payload: { code: "protocol", message: "failed" },
      })
    ).toMatchObject({ event: "error" })
  })

  it("falls back to generic incoming message parsing for unknown event type", () => {
    const parsed = gatewayIncomingMessageSchema.parse({
      id: "unknown-1",
      type: "event",
      event: "unknown.event",
      payload: { anything: true },
    })

    expect(parsed.type).toBe("event")
    expect((parsed as { event: string }).event).toBe("unknown.event")
  })

  it("validates outgoing union and rejects unknown request methods", () => {
    expect(
      gatewayOutgoingMessageSchema.safeParse({
        id: "id",
        type: "req",
        method: "not-supported",
        params: {},
      }).success
    ).toBe(false)
  })
})
