import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { http, HttpResponse } from "msw"

import { OPTIONS, POST } from "../../app/api/chat/route"
import { __resetRateLimitStore } from "../../lib/middleware/rate-limit"
import { server } from "../mocks/server"

const baseEnv = {
  ELEVENLABS_API_KEY: "eleven-key",
  ELEVENLABS_VOICE_ID: "voice-id",
  OPENCLAW_GATEWAY_URL: "https://gateway.example.com",
  OPENCLAW_GATEWAY_TOKEN: "gateway-token",
}

const createMockRequest = (
  url: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
) => {
  const headers = new Headers()
  const headerConfig = init.headers ?? {}

  if (headerConfig.Origin) {
    headers.set("origin", headerConfig.Origin)
    headers.set("Origin", headerConfig.Origin)
    delete headerConfig.Origin
  } else if (headerConfig.origin) {
    headers.set("origin", headerConfig.origin)
    headers.set("Origin", headerConfig.origin)
    delete headerConfig.origin
  } else {
    headers.set("origin", "https://app.local")
    headers.set("Origin", "https://app.local")
  }

  for (const [name, value] of Object.entries(headerConfig)) {
    headers.set(name, value)
  }

  const request = new Request(url, {
    method: init.method,
    body: init.body as BodyInit,
    headers,
  }) as unknown as NextRequest

  ;(request as { headers: Headers }).headers = headers
  return request
}

const setEnv = () => {
  Object.entries({
    ...baseEnv,
    OPENCLAW_RATE_LIMIT: "2",
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

describe("Chat route integration", () => {
  beforeEach(() => {
    setEnv()
    __resetRateLimitStore()
  })

  it("returns assistant reply for valid chat payload", async () => {
    const response = await POST(createChatRequest({ message: "Hello" }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.local")
    expect(payload).toHaveProperty("text")
    expect(payload.text).toContain("Mock reply for: Hello")
    expect(payload.conversationHistory).toHaveLength(2)
  })

  it("returns 400 when message is missing", async () => {
    const response = await POST(createChatRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe("Invalid request")
  })

  it("returns 400 when message exceeds max length", async () => {
    const response = await POST(createChatRequest({ message: "a".repeat(4001) }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe("Invalid request")
  })

  it("returns 400 when conversation history exceeds max length", async () => {
    const response = await POST(
      createChatRequest({
        message: "Hello",
        conversationHistory: Array.from({ length: 21 }).map((_, index) => ({
          role: index % 2 === 0 ? "user" : "assistant",
          content: "x",
        })),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe("Invalid request")
  })

  it("returns 502 when upstream Chat service fails", async () => {
    server.use(
      http.post(/.*\/v1\/chat\/completions$/, () => {
        return HttpResponse.json({ message: "failed" }, { status: 500 })
      })
    )

    const response = await POST(createChatRequest({ message: "Hello" }))
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error).toBe("Chat completion failed")
  })

  it("returns 429 when rate limit is exceeded", async () => {
    process.env.OPENCLAW_RATE_LIMIT = "1"

    const req1 = createChatRequest({ message: "Hello" }, { "x-forwarded-for": "3.3.3.3" })
    const req2 = createChatRequest({ message: "Hello" }, { "x-forwarded-for": "3.3.3.3" })

    const first = await POST(req1)
    expect(first.status).toBe(200)

    const second = await POST(req2)
    expect(second.status).toBe(429)
    expect(await second.json()).toEqual({ error: "Too many requests" })
  })

  it("returns preflight CORS response", async () => {
    const request = createMockRequest("http://localhost/api/chat", {
      method: "OPTIONS",
      headers: { Origin: "https://app.local" },
    })
    const response = await OPTIONS(request)

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.local")
  })
})
