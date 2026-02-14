import { NextRequest, NextResponse } from "next/server"

const ALLOWED_HEADERS = "Content-Type, Authorization, x-api-key"
const ALLOWED_METHODS = "GET, POST, OPTIONS"

export function createCorsHeaders(request: NextRequest) {
  const requestOrigin =
    request.headers.get("origin") ?? request.headers.get("Origin") ?? request.headers.get("ORIGIN")
  return {
    "Access-Control-Allow-Origin": requestOrigin ?? "*",
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  } as const
}

export function applyCorsHeaders<T extends NextResponse>(response: T, request: NextRequest) {
  const cors = createCorsHeaders(request)
  for (const [key, value] of Object.entries(cors)) {
    response.headers.set(key, value)
  }
  return response
}

export function corsPreflightResponse(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: createCorsHeaders(request),
  })
}
