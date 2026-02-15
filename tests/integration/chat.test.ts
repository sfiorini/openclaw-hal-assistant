import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { http, HttpResponse } from "msw"

import { OPTIONS, POST } from "../../app/api/chat/route"
import { GET, DELETE } from "../../app/api/chat/jobs/[id]/route"
import { __resetChatJobsForTests } from "../../lib/chat/jobs"
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
  } else if (headerConfig.origin) {
    headers.set("origin", headerConfig.origin)
  } else {
    headers.set("origin", "https://app.local")
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

const createJobRequest = (jobId: string, method = "GET") =>
  createMockRequest(`http://localhost/api/chat/jobs/${jobId}`, {
    method,
  })

const pollJob = async (jobId: string) => {
  const response = await GET(createJobRequest(jobId), {
    params: Promise.resolve({ id: jobId }),
  })
  return { response, payload: await response.json() }
}

const waitForTerminal = async (jobId: string, attempts = 10) => {
  let lastPayload: Record<string, unknown> | null = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const polled = await pollJob(jobId)
    if (polled.response.status !== 200) {
      throw new Error(`Poll failed: ${polled.response.status}`)
    }

    lastPayload = polled.payload
    if (lastPayload.status === "completed" || lastPayload.status === "failed" || lastPayload.status === "cancelled") {
      return lastPayload
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(`Job did not reach terminal state: ${JSON.stringify(lastPayload)}`)
}

describe("Chat async job routes", () => {
  beforeEach(() => {
    setEnv()
    __resetChatJobsForTests()
  })

  it("returns async job submission metadata", async () => {
    const response = await POST(createChatRequest({ message: "Hello" }))
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.local")
    expect(payload.status).toBe("queued")
    expect(typeof payload.jobId).toBe("string")
    expect(payload.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  )
    expect(payload.maxPollAttempts).toBeGreaterThan(0)
  })

  it("deduplicates requests with same idempotency key", async () => {
    const headers = { "Idempotency-Key": "same-key-1" }
    const first = await POST(createChatRequest({ message: "Hello" }, headers))
    const second = await POST(createChatRequest({ message: "Hello" }, headers))

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)

    const firstPayload = await first.json()
    const secondPayload = await second.json()
    expect(secondPayload.jobId).toBe(firstPayload.jobId)
  })

  it("returns failed state when upstream chat endpoint fails", async () => {
    server.use(
      http.post(/.*\/v1\/chat\/completions$/, () => {
        return HttpResponse.json({ error: "tool down" }, { status: 500 })
      })
    )

    const response = await POST(createChatRequest({ message: "Hello" }))
    const payload = await response.json()
    expect(response.status).toBe(202)

    const terminalStatus = await waitForTerminal(payload.jobId)
    expect(terminalStatus.status).toBe("failed")
    expect(terminalStatus.error).toBeDefined()
    expect(terminalStatus.error.code).toBe("upstream_error")
  })

  it("returns 429 when rate limit is exceeded", async () => {
    process.env.OPENCLAW_RATE_LIMIT = "1"

    const req1 = createChatRequest({ message: "Hello" }, { "x-forwarded-for": "3.3.3.3" })
    const req2 = createChatRequest({ message: "Hello" }, { "x-forwarded-for": "3.3.3.3" })

    const first = await POST(req1)
    expect(first.status).toBe(202)

    const second = await POST(req2)
    expect(second.status).toBe(429)
    expect(await second.json()).toEqual({ error: "Too many requests" })
  })

  it("supports cancellation and returns cancelled state", async () => {
    const response = await POST(createChatRequest({ message: "Hello for cancel" }))
    const payload = await response.json()

    const cancelResponse = await DELETE(createJobRequest(payload.jobId), {
      params: Promise.resolve({ id: payload.jobId }),
      method: "DELETE",
    })

    expect(cancelResponse.status).toBe(200)
    const cancelPayload = await cancelResponse.json()
    expect(cancelPayload.status).toBe("cancelled")
  })

  it("returns 404 for unknown job id on cancellation", async () => {
    const missing = await DELETE(createJobRequest("f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2"), {
      params: Promise.resolve({ id: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2" }),
      method: "DELETE",
    })

    expect(missing.status).toBe(404)
  })

  it("returns idempotent cancelled state when deleting an already cancelled job", async () => {
    const response = await POST(createChatRequest({ message: "Cancel twice" }))
    const payload = await response.json()

    const firstCancel = await DELETE(createJobRequest(payload.jobId), {
      params: Promise.resolve({ id: payload.jobId }),
      method: "DELETE",
    })
    expect(firstCancel.status).toBe(200)

    const secondCancel = await DELETE(createJobRequest(payload.jobId), {
      params: Promise.resolve({ id: payload.jobId }),
      method: "DELETE",
    })
    expect(secondCancel.status).toBe(200)
    const secondPayload = await secondCancel.json()
    expect(secondPayload.status).toBe("cancelled")
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
