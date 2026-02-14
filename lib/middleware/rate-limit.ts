import { NextRequest, NextResponse } from "next/server"

type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitOptions = {
  limit?: number
  windowMs?: number
}

const STORAGE = new Map<string, RateLimitEntry>()

export function __resetRateLimitStore() {
  STORAGE.clear()
}

export function getClientIdentity(request: NextRequest) {
  const xff = request.headers.get("x-forwarded-for")
  const directIp = (request as { ip?: string }).ip

  if (xff) {
    return xff.split(",")[0]?.trim() || "unknown"
  }

  return directIp || "unknown"
}

export function checkRateLimit(
  key: string,
  options: RateLimitOptions = {}
): {
  allowed: boolean
  remaining: number
  retryAfterSeconds?: number
} {
  const limit = options.limit ?? 60
  const windowMs = options.windowMs ?? 60_000
  const now = Date.now()

  const entry = STORAGE.get(key)
  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs
    STORAGE.set(key, { count: 1, resetAt })
    return {
      allowed: true,
      remaining: limit - 1,
    }
  }

  if (entry.count < limit) {
    entry.count += 1
    STORAGE.set(key, entry)
    return {
      allowed: true,
      remaining: Math.max(0, limit - entry.count),
    }
  }

  const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000)
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds,
  }
}

export function createRateLimitResponse(
  key: string,
  limit: number
) {
  const { allowed, remaining, retryAfterSeconds } = checkRateLimit(key, { limit })
  if (allowed) {
    return null
  }

  const headers = new Headers()
  headers.set("Retry-After", `${Math.max(0, retryAfterSeconds ?? 0)}`)
  headers.set("X-RateLimit-Limit", `${limit}`)
  headers.set("X-RateLimit-Remaining", `${remaining}`)

  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers }
  )
}

export function limitRequest(request: NextRequest, limit: number) {
  const key = getClientIdentity(request)
  return createRateLimitResponse(key, limit)
}
