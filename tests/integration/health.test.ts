import { beforeEach, describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"

import { GET as GET_HEALTH_LIVE } from "../../app/api/health/live/route"
import { GET as GET_HEALTH_STARTUP } from "../../app/api/health/startup/route"
import { server } from "../mocks/server"

const baseEnv = {
  ELEVENLABS_API_KEY: "eleven-key",
  ELEVENLABS_VOICE_ID: "voice-id",
  OPENCLAW_GATEWAY_URL: "ws://gateway.example.com",
  OPENCLAW_GATEWAY_TOKEN: "gateway-token",
}

const setEnv = () => {
  Object.entries(baseEnv).forEach(([key, value]) => {
    process.env[key] = value
  })
}

const mockHealthyDependencies = () => {
  server.use(
    http.get("https://api.elevenlabs.io/v1/user", () => {
      return HttpResponse.json({ id: "voice-id", name: "demo" })
    }),
    http.get(/.*\/v1\/models$/, () => {
      return HttpResponse.json({ models: [] })
    })
  )
}

describe("Health endpoints", () => {
  beforeEach(() => {
    setEnv()
    mockHealthyDependencies()
  })

  it("returns liveness status and timestamp", async () => {
    const response = await GET_HEALTH_LIVE()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.status).toBe("ok")
    expect(typeof payload.timestamp).toBe("string")
    expect(Number.isFinite(Date.parse(payload.timestamp))).toBe(true)
  })

  it("returns startup health when all dependencies are healthy", async () => {
    const response = await GET_HEALTH_STARTUP()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.status).toBe("ok")
    expect(payload.checks.elevenLabs).toMatchObject({
      status: "up",
    })
    expect(payload.checks.openClaw).toMatchObject({
      status: "up",
    })
    expect(payload.checks.elevenLabs.latencyMs).toBeTypeOf("number")
    expect(payload.checks.openClaw.latencyMs).toBeTypeOf("number")
  })

  it("returns startup degraded when ElevenLabs is unhealthy", async () => {
    server.use(
      http.get("https://api.elevenlabs.io/v1/user", () => {
        return HttpResponse.json({ message: "down" }, { status: 503 })
      })
    )

    const response = await GET_HEALTH_STARTUP()
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.status).toBe("degraded")
    expect(payload.checks.elevenLabs.status).toBe("down")
    expect(payload.checks.openClaw.status).toBe("up")
  })

  it("returns startup degraded when OpenClaw is unhealthy", async () => {
    server.use(
      http.get(/.*\/v1\/models$/, () => {
        return HttpResponse.json({ message: "down" }, { status: 503 })
      })
    )

    const response = await GET_HEALTH_STARTUP()
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.status).toBe("degraded")
    expect(payload.checks.elevenLabs.status).toBe("up")
    expect(payload.checks.openClaw.status).toBe("down")
  })

  it("returns startup degraded when both dependencies are unhealthy", async () => {
    server.use(
      http.get("https://api.elevenlabs.io/v1/user", () => {
        return HttpResponse.json({ message: "down" }, { status: 503 })
      }),
      http.get(/.*\/v1\/models$/, () => {
        return HttpResponse.json({ message: "down" }, { status: 503 })
      })
    )

    const response = await GET_HEALTH_STARTUP()
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.status).toBe("degraded")
    expect(payload.checks.elevenLabs.status).toBe("down")
    expect(payload.checks.openClaw.status).toBe("down")
  })
})
