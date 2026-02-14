import { NextRequest, NextResponse } from "next/server"

type AuthConfig = {
  requiredApiKey?: string
}

export function getApiKeyFromRequest(request: NextRequest): string | null {
  return request.headers.get("x-api-key")
}

export async function withApiKeyAuth(
  request: NextRequest,
  config: AuthConfig = {}
) {
  const providedKey = getApiKeyFromRequest(request)
  const allowedKey = config.requiredApiKey

  if (!providedKey) {
    return null
  }

  if (!allowedKey) {
    return NextResponse.json(
      { error: "OpenClaw API key is not configured" },
      { status: 401 }
    )
  }

  if (providedKey !== allowedKey) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401 }
    )
  }

  return null
}
