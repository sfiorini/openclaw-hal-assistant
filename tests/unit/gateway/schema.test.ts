import { describe, expect, it } from "vitest"

import {
  gatewayAgentEventSchema,
  gatewayAgentWaitRequestSchema,
  gatewayChatEventSchema,
  gatewayChatSendRequestSchema,
  gatewayConnectChallengeSchema,
  gatewayConnectRespondSchema,
  gatewayConnectRequestSchema,
  gatewayIncomingMessageSchema,
  gatewayOutgoingMessageSchema,
} from "../../../lib/openclaw/gateway.schema"

describe("gateway schemas", () => {
  it("validates protocol v3 connect payload", () => {
    const parsed = gatewayConnectRequestSchema.parse({
      id: "connect-1",
      type: "req",
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "cli",
          version: "1.0.0",
          platform: "linux",
          mode: "node",
        },
        auth: {
          token: "gateway-token",
        },
      },
    })

    expect(parsed.params.minProtocol).toBe(3)
    expect(parsed.params.client.id).toBe("cli")
  })

  it("validates connect.challenge payload", () => {
    const parsed = gatewayConnectChallengeSchema.parse({
      type: "event",
      event: "connect.challenge",
      payload: {
        nonce: "abc-123",
        ts: 123456,
      },
    })

    expect(parsed.payload.nonce).toBe("abc-123")
  })

  it("validates connect.respond payload", () => {
    const parsed = gatewayConnectRespondSchema.parse({
      id: "challenge-1",
      type: "req",
      method: "connect.respond",
      params: {
        response: "signed-response",
      },
    })

    expect(parsed.params.response).toBe("signed-response")
  })

  it("validates chat.send payload", () => {
    const parsed = gatewayChatSendRequestSchema.parse({
      id: "chat-1",
      type: "req",
      method: "chat.send",
      params: {
        sessionKey: "agent:main:test",
        message: "Say hello",
        idempotencyKey: "idem-1",
      },
    })

    expect(parsed.params.message).toBe("Say hello")
    expect(parsed.params.sessionKey).toBe("agent:main:test")
  })

  it("validates agent.wait payload", () => {
    const parsed = gatewayAgentWaitRequestSchema.parse({
      id: "wait-1",
      type: "req",
      method: "agent.wait",
      params: { runId: "run-1" },
    })

    expect(parsed.params.runId).toBe("run-1")
  })

  it("validates agent and chat stream events", () => {
    expect(
      gatewayAgentEventSchema.parse({
        type: "event",
        event: "agent",
        payload: {
          runId: "run-1",
          stream: "assistant",
          data: { delta: "Hi" },
        },
      })
    ).toBeDefined()

    expect(
      gatewayChatEventSchema.parse({
        type: "event",
        event: "chat",
        payload: {
          runId: "run-1",
          state: "final",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hi" }],
          },
        },
      })
    ).toBeDefined()
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
