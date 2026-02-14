import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { http, HttpResponse } from "msw"

import { OPTIONS, POST } from "../../app/api/stt/route"
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

const createSTTRequest = (options?: {
  body?: FormData
  headers?: Record<string, string>
}) => {
  const formData = options?.body ?? new FormData()
  return createMockRequest("http://localhost/api/stt", {
    method: "POST",
    body: formData,
    headers: {
      Origin: "https://app.local",
      ...options?.headers,
    },
  })
}

const createSTTRequestWithAudio = (headers: Record<string, string> = {}) => {
  const formData = new FormData()
  formData.append("audio", new Blob(["hello"]), "audio.wav")
  return createSTTRequest({
    body: formData,
    headers,
  })
}

describe("STT route integration", () => {
  beforeEach(() => {
    setEnv()
    __resetRateLimitStore()
  })

  it("returns transcription when multipart audio is valid", async () => {
    const formData = new FormData()
    formData.append("audio", new Blob(["hello"]), "audio.wav")

    const response = await POST(createSTTRequest({ body: formData }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.local")
    expect(payload).toEqual({ text: "mocked transcription" })
  })

  it("returns 400 when audio is missing", async () => {
    const response = await POST(createSTTRequest({}))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe("Invalid request")
  })

  it("returns 502 when upstream STT service fails", async () => {
    server.use(
      http.post("https://api.elevenlabs.io/v1/speech-to-text", () => {
        return HttpResponse.json({ message: "failed" }, { status: 503 })
      })
    )

    const formData = new FormData()
    formData.append("audio", new Blob(["hello"]), "audio.wav")
    const response = await POST(createSTTRequest({ body: formData }))
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error).toBe("Speech-to-text conversion failed")
  })

  it("returns 429 when rate limit is exceeded", async () => {
    process.env.OPENCLAW_RATE_LIMIT = "1"
    const req1 = createSTTRequestWithAudio({ "x-forwarded-for": "1.1.1.1" })
    const req2 = createSTTRequestWithAudio({ "x-forwarded-for": "1.1.1.1" })

    const first = await POST(req1)
    expect(first.status).toBe(200)

    const second = await POST(req2)
    expect(second.status).toBe(429)
    expect(await second.json()).toEqual({ error: "Too many requests" })
  })

  it("returns preflight CORS response", async () => {
    const request = createMockRequest("http://localhost/api/stt", {
      method: "OPTIONS",
      headers: { Origin: "https://app.local" },
    })
    const response = await OPTIONS(request)

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.local")
  })
})
