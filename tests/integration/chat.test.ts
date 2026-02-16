import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

import { GatewayClientError } from "../../lib/openclaw/gateway.types"
import { OPTIONS, POST } from "../../app/api/chat/route"
import {
  __resetChatSessionsForTests,
  getChatSession,
} from "../../lib/chat/sessions"
import { chatWithGateway } from "../../lib/openclaw/gateway-client"

vi.mock("../../lib/openclaw/gateway-client", () => ({
  chatWithGateway: vi.fn(),
}))

const createMockRequest = (
  url: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
) => {
  const headers = new Headers()
  const headerConfig = init.headers ?? {}

  headers.set("origin", headerConfig.Origin ?? headerConfig.origin ?? "https://app.local")
  for (const [name, value] of Object.entries(headerConfig)) {
    headers.set(name, value)
  }

  const request = new Request(url, {
    method: init.method,
    body: init.body as BodyInit,
    headers,
  }) as unknown as NextRequest

  return request
}

const setEnv = () => {
  delete process.env.OPENCLAW_SESSION_ID

  Object.entries({
    ELEVENLABS_API_KEY: "eleven-key",
    ELEVENLABS_VOICE_ID: "voice-id",
    OPENCLAW_GATEWAY_URL: "ws://gateway.example.com",
    OPENCLAW_GATEWAY_TOKEN: "gateway-token",
    OPENCLAW_API_DOCS_ENABLED: "false",
    OPENCLAW_RATE_LIMIT: "100",
  }).forEach(([key, value]) => {
    process.env[key] = value
  })
}

const createChatRequest = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  createMockRequest("http://localhost/api/chat", {
    method: "POST",
    headers: {
      Origin: "https://app.local",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })

const deferred = <T>() => {
  let resolve: (value: T) => void
  let reject: (reason?: unknown) => void
  const promise = new Promise<T>((localResolve, localReject) => {
    resolve = localResolve
    reject = localReject
  })
  return { promise, resolve: resolve!, reject: reject! }
}

describe("Chat direct response", () => {
  beforeEach(() => {
    setEnv()
    __resetChatSessionsForTests()
    vi.mocked(chatWithGateway).mockReset()
  })

  it("returns direct chat completion with session id", async () => {
    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "HAL says yes",
      conversationId: "f7e1f3d0-3f0d-4f3a-b5a8-7b6bbf7b0f11",
    })

    const response = await POST(
      createChatRequest({
        message: "Hello",
        conversationHistory: [{ role: "user", content: "Hi" }],
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.text).toBe("HAL says yes")
    expect(payload.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(payload.conversationHistory).toHaveLength(3)
    expect(payload.conversationHistory[0]).toMatchObject({
      role: "user",
      content: "Hi",
    })
    expect(payload.conversationHistory[1]).toMatchObject({
      role: "user",
      content: "Hello",
    })
    expect(payload.conversationHistory[2]).toMatchObject({
      role: "assistant",
      content: "HAL says yes",
    })
  })

  it("uses OPENCLAW_SESSION_ID when no sessionId is provided", async () => {
    const previous = process.env.OPENCLAW_SESSION_ID
    process.env.OPENCLAW_SESSION_ID = "11111111-1111-4111-8111-111111111111"

    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "Using configured session",
      conversationId: "11111111-1111-4111-8111-111111111111",
    })

    const response = await POST(createChatRequest({ message: "check default session" }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.sessionId).toBe("11111111-1111-4111-8111-111111111111")

    if (previous) {
      process.env.OPENCLAW_SESSION_ID = previous
    } else {
      delete process.env.OPENCLAW_SESSION_ID
    }
  })

  it("reuses session id by default for follow-up messages", async () => {
    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "first response",
      conversationId: "d6ab2f4e-a0d4-4d0d-bb1d-6a7cd7f2f111",
    })

    const first = await POST(createChatRequest({ message: "First message" }))
    const firstPayload = await first.json()
    expect(first.status).toBe(200)

    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "second response",
      conversationId: firstPayload.sessionId,
    })

    const second = await POST(
      createChatRequest({
        message: "Second message",
        sessionId: firstPayload.sessionId,
      })
    )
    const secondPayload = await second.json()

    expect(second.status).toBe(200)
    expect(secondPayload.sessionId).toBe(firstPayload.sessionId)
  })

  it("persists and appends session conversation turns", async () => {
    const captured: Array<{ conversationId?: string; text?: string; gatewayPayload?: Record<string, unknown> }> = []

    vi.mocked(chatWithGateway).mockImplementation(async (input) => {
      captured.push({
        conversationId: input.conversationId,
        text: input.text,
        gatewayPayload: {
          conversationId: input.conversationId,
          text: input.text,
          metadata: input.metadata,
        },
      })

      return {
        text: `reply:${input.text}`,
        conversationId:
          input.conversationId ??
          (captured.length === 1
            ? "fbe9c6d8-b3eb-4e7b-a9b3-d1f4f4f6ef2a"
            : "c4b4f4f8-a5cd-4f63-b9bc-6a6d6ad1e9a6"),
      }
    })

    const first = await POST(createChatRequest({ message: "How are you?" }))
    const firstPayload = await first.json()
    expect(first.status).toBe(200)

    const session = getChatSession(firstPayload.sessionId)
    expect(session?.conversation).toHaveLength(2)

    vi.mocked(chatWithGateway).mockImplementation(async (input) => ({
      text: `reply2:${input.text}`,
      conversationId: firstPayload.sessionId,
    }))

    const second = await POST(
      createChatRequest({
        message: "Tell me more",
        sessionId: firstPayload.sessionId,
      })
    )
    const secondPayload = await second.json()
    expect(second.status).toBe(200)
    expect(secondPayload.sessionId).toBe(firstPayload.sessionId)

    const updated = getChatSession(firstPayload.sessionId)
    expect(updated?.conversation).toHaveLength(4)
    expect(updated?.conversation.at(1)?.content).toBe("reply:How are you?")
    expect(updated?.conversation.at(3)?.content).toBe("reply2:Tell me more")
  })

  it("forwards command reset behavior to new session", async () => {
    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "Fresh session start",
      conversationId: "8d6e4f8f-5f4d-4f6b-97d1-9a2e8f6e9f01",
    })

    const first = await POST(createChatRequest({ message: "Hello old" }))
    const firstPayload = await first.json()

    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "Reset response",
      conversationId: "2c7d5f67-4f65-48a8-9f4b-9b2f8f9c4d02",
    })

    const second = await POST(
      createChatRequest({ message: "/new tell me a joke", sessionId: firstPayload.sessionId })
    )
    const secondPayload = await second.json()

    expect(secondPayload.sessionId).not.toBe(firstPayload.sessionId)
  })

  it("maps '/new' command and strips command from message", async () => {
    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "Model selected",
      conversationId: "3f4f2c8a-8b4f-4ed4-8f74-1d9f1f9d3e03",
    })

    const response = await POST(
      createChatRequest({ message: "/new hal-test-model start" })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.text).toBe("Model selected")

    const [firstCall] = vi.mocked(chatWithGateway).mock.calls
    expect(firstCall).toBeDefined()
    expect(firstCall[0].text).toBe("hal-test-model start")
  })

  it("bootstraps default model only on the first turn of a session", async () => {
    const previousDefaultModel = process.env.OPENCLAW_DEFAULT_AGENT_MODEL
    process.env.OPENCLAW_DEFAULT_AGENT_MODEL = "hal-default-model"

    const seenTexts: string[] = []

    vi.mocked(chatWithGateway).mockImplementation(async (input) => {
      seenTexts.push(input.text)
      return {
        text: `reply:${input.text}`,
        conversationId:
          input.conversationId ?? "5ca7c3be-640f-4e90-9f3e-7d1c7c0a2c0d",
      }
    })

    const first = await POST(createChatRequest({ message: "Hello there" }))
    const firstPayload = await first.json()

    expect(first.status).toBe(200)
    expect(seenTexts[0]).toBe("/new hal-default-model Hello there")

    const second = await POST(
      createChatRequest({
        message: "Tell me more",
        sessionId: firstPayload.sessionId,
      })
    )

    expect(second.status).toBe(200)
    expect(seenTexts[1]).toBe("Tell me more")

    if (previousDefaultModel) {
      process.env.OPENCLAW_DEFAULT_AGENT_MODEL = previousDefaultModel
    } else {
      delete process.env.OPENCLAW_DEFAULT_AGENT_MODEL
    }
  })

  it("returns 503 when session max concurrent jobs is reached", async () => {
    const hold = deferred<{ text: string; conversationId: string }>()
    const firstStarted = deferred<string>()
    let firstConversationId: string | undefined

    vi.mocked(chatWithGateway)
      .mockImplementationOnce(async (input) => {
        firstConversationId = input.conversationId
        firstStarted.resolve(input.conversationId ?? "")
        return hold.promise
      })
      .mockResolvedValue({
        text: "Second blocked response",
        conversationId: "b4d2f0a3-8f2d-4f5b-b0f1-e9c4a4e3f505",
      })

    const first = POST(createChatRequest({ message: "First message" }))
    firstConversationId = await firstStarted.promise
    expect(firstConversationId).toBeTruthy()

    const second = await POST(
      createChatRequest({ message: "Second message", sessionId: firstConversationId })
    )
    expect(second.status).toBe(503)
    expect(await second.json()).toMatchObject({
      error: "Concurrency limit reached",
      code: "concurrency_error",
    })

    hold.resolve({
      text: "First done",
      conversationId: firstConversationId,
    })

    await first
  })

  it("returns upstream errors from gateway as 502", async () => {
    vi.mocked(chatWithGateway).mockRejectedValue(
      new GatewayClientError("Upstream service failed", { code: "upstream" })
    )

    const response = await POST(createChatRequest({ message: "Hello fail" }))
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error).toBe("Upstream service failed")
    expect(payload.code).toBe("upstream")
  })

  it("returns 429 when rate limit is exceeded", async () => {
    process.env.OPENCLAW_RATE_LIMIT = "1"

    vi.mocked(chatWithGateway).mockResolvedValue({
      text: "First",
      conversationId: "5f6e7f9b-3f6a-4ff2-9c91-2f9f3d4e4a07",
    })

    const first = await POST(
      createChatRequest({ message: "Hello" }, { "x-forwarded-for": "10.0.0.3" })
    )

    const second = await POST(
      createChatRequest({ message: "Hello" }, { "x-forwarded-for": "10.0.0.3" })
    )

    const third = await POST(
      createChatRequest({ message: "Hello" }, { "x-forwarded-for": "10.0.0.3" })
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(third.status).toBe(429)
    expect(await second.json()).toEqual({ error: "Too many requests" })
  })

  it("returns preflight CORS response", async () => {
    const request = createMockRequest("http://localhost/api/chat", {
      method: "OPTIONS",
      headers: { Origin: "https://app.local" },
    })
    const response = await OPTIONS(request)

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })
})
