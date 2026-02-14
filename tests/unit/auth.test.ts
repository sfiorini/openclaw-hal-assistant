import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import { withApiKeyAuth } from "../../lib/middleware/auth"

describe("auth middleware", () => {
  it("allows requests without x-api-key", async () => {
    const request = new NextRequest("http://localhost/api")
    const result = await withApiKeyAuth(request, {})
    expect(result).toBeNull()
  })

  it("allows requests with matching x-api-key", async () => {
    const request = new NextRequest("http://localhost/api", {
      headers: {
        "x-api-key": "secret",
      },
    })

    const result = await withApiKeyAuth(request, {
      requiredApiKey: "secret",
    })

    expect(result).toBeNull()
  })

  it("rejects requests with invalid x-api-key", async () => {
    const request = new NextRequest("http://localhost/api", {
      headers: {
        "x-api-key": "wrong",
      },
    })

    const result = await withApiKeyAuth(request, {
      requiredApiKey: "secret",
    })

    expect(result).not.toBeNull()
    expect(result?.status).toBe(401)
  })

  it("rejects requests when x-api-key provided but not configured", async () => {
    const request = new NextRequest("http://localhost/api", {
      headers: {
        "x-api-key": "secret",
      },
    })

    const result = await withApiKeyAuth(request, {})

    expect(result).not.toBeNull()
    expect(result?.status).toBe(401)
  })
})
