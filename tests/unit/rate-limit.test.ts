import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

import {
  __resetRateLimitStore,
  checkRateLimit,
  createRateLimitResponse,
  getClientIdentity,
} from "../../lib/middleware/rate-limit"

describe("rate-limit middleware", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    __resetRateLimitStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows first request", () => {
    const result = checkRateLimit("client-a", { limit: 2, windowMs: 1000 })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(1)
  })

  it("allows requests under limit", () => {
    const first = checkRateLimit("client-a", { limit: 2, windowMs: 1000 })
    const second = checkRateLimit("client-a", { limit: 2, windowMs: 1000 })

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(0)
  })

  it("rate limits at configured limit", () => {
    expect(checkRateLimit("client-a", { limit: 1, windowMs: 1000 }).allowed).toBe(true)
    const blocked = checkRateLimit("client-a", { limit: 1, windowMs: 1000 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it("returns 429 with Retry-After header", () => {
    const req = new NextRequest("http://localhost/api", {
      headers: {
        "x-forwarded-for": "10.0.0.1",
      },
    })

    expect(createRateLimitResponse(getClientIdentity(req), 1)).toBeNull()

    const response = createRateLimitResponse(getClientIdentity(req), 1)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(429)
    expect(response?.headers.get("Retry-After")).toBe("60")
  })

  it("resets when window expires", () => {
    const first = checkRateLimit("client-a", { limit: 1, windowMs: 1000 })
    expect(first.allowed).toBe(true)

    const second = checkRateLimit("client-a", { limit: 1, windowMs: 1000 })
    expect(second.allowed).toBe(false)

    vi.advanceTimersByTime(1000)

    const third = checkRateLimit("client-a", { limit: 1, windowMs: 1000 })
    expect(third.allowed).toBe(true)
  })
})
