import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { http, HttpResponse } from "msw"

import { OPTIONS, POST } from "../../app/api/tts/route"
import { __resetRateLimitStore } from "../../lib/middleware/rate-limit"
import { server } from "../mocks/server"

const baseEnv = {
  ELEVENLABS_API_KEY: "eleven-key",
  ELEVENLABS_VOICE_ID: "voice-id",
  OPENCLAW_GATEWAY_URL: "ws://gateway.example.com",
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

const createTTSRequest = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  createMockRequest("http://localhost/api/tts", {
    method: "POST",
    headers: {
      Origin: "https://app.local",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })

describe("TTS route integration", () => {
  beforeEach(() => {
    setEnv()
    __resetRateLimitStore()
  })

  it("returns synthesized audio for valid text", async () => {
    const response = await POST(createTTSRequest({ text: "Hello HAL" }))
    const body = await response.arrayBuffer()

    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.local")
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg")
    expect(body.byteLength).toBeGreaterThan(0)
  })

  it("returns 400 when text is missing", async () => {
    const response = await POST(createTTSRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe("Invalid request")
  })

  it("returns 400 when text exceeds limit", async () => {
    const response = await POST(createTTSRequest({ text: "a".repeat(5001) }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe("Invalid request")
  })

  it("returns 502 when upstream TTS service fails", async () => {
    server.use(
      http.post("https://api.elevenlabs.io/v1/text-to-speech/:voiceId", () => {
        return HttpResponse.json({ message: "failed" }, { status: 500 })
      })
    )

    const response = await POST(createTTSRequest({ text: "Hello HAL" }))
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error).toBe("Text-to-speech conversion failed")
  })

  it("returns 429 when rate limit is exceeded", async () => {
    process.env.OPENCLAW_RATE_LIMIT = "1"
    const payload = { text: "Hi" }

    const req1 = createTTSRequest(payload, { "x-forwarded-for": "2.2.2.2" })
    const req2 = createTTSRequest(payload, { "x-forwarded-for": "2.2.2.2" })

    const first = await POST(req1)
    expect(first.status).toBe(200)

    const second = await POST(req2)
    expect(second.status).toBe(429)
    expect(await second.json()).toEqual({ error: "Too many requests" })
  })

  it("returns preflight CORS response", async () => {
    const request = createMockRequest("http://localhost/api/tts", {
      method: "OPTIONS",
      headers: { Origin: "https://app.local" },
    })
    const response = await OPTIONS(request)

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.local")
  })
})
