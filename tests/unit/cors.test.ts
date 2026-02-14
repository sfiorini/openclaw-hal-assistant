import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import { createCorsHeaders, corsPreflightResponse } from "../../lib/middleware/cors"

const createRequest = (url: string, options: { method?: string; origin?: string } = {}) => {
  const headers = new Headers()
  if (options.origin) {
    headers.set("origin", options.origin)
    headers.set("Origin", options.origin)
  }

  const request = new Request(url, {
    method: options.method,
    headers,
  }) as unknown as NextRequest

  ;(request as { headers: Headers }).headers = headers
  return request
}

describe("cors middleware", () => {
  it("returns expected headers object", () => {
    const request = createRequest("http://localhost/api", {
      origin: "https://example.com",
    })

    const headers = createCorsHeaders(request)

    expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com")
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST")
    expect(headers["Access-Control-Allow-Headers"]).toContain("x-api-key")
  })

  it("returns preflight 204", () => {
    const request = createRequest("http://localhost/api", {
      method: "OPTIONS",
      origin: "https://example.com",
    })

    const response = corsPreflightResponse(request)

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS")
  })
})
