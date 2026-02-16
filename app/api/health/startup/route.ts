import { NextResponse } from "next/server"

import { getServerEnvConfig } from "../../../../lib/config/env"

type HealthStatus = "up" | "down"

type DependencyCheck = {
  status: HealthStatus
  latencyMs: number
  error?: string
}

type StartupHealthPayload = {
  status: "ok" | "degraded"
  timestamp: string
  checks: {
    elevenLabs: DependencyCheck
    openClaw: DependencyCheck
  }
}

const SOCKET_HEALTH_TIMEOUT_MS = 3000

const normalizeGatewayBaseUrl = (value: string) => {
  const withoutTrailingSlash = value
    .trim()
    .replace(/^ws:/, "http:")
    .replace(/^wss:/, "https:")
    .replace(/\/+$/, "")
  if (withoutTrailingSlash.toLowerCase().endsWith("/v1")) {
    return withoutTrailingSlash.slice(0, -3)
  }
  return withoutTrailingSlash
}

const normalizeGatewaySocketUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -3)
  }
  return trimmed
}

const buildGatewayHttpUrl = (gatewayUrl: string, path: string) => {
  const base = normalizeGatewayBaseUrl(gatewayUrl)
  return `${base}/v1${path}`
}

const checkUrl = async (
  url: string,
  headers: Record<string, string> = {}
): Promise<DependencyCheck> => {
  const startMs = Date.now()
  const response = await fetch(url, {
    method: "GET",
    headers,
  })
  const latencyMs = Date.now() - startMs

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    return {
      status: "down",
      latencyMs,
      error: `status_${response.status}${body ? `: ${body}` : ""}`,
    }
  }

  return { status: "up", latencyMs }
}

const checkDependency = async (
  url: string,
  headers: Record<string, string> = {}
): Promise<DependencyCheck> => {
  try {
    return await checkUrl(url, headers)
  } catch (error) {
    return {
      status: "down",
      latencyMs: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

const checkGatewaySocket = async (gatewayUrl: string): Promise<DependencyCheck> => {
  if (typeof WebSocket === "undefined") {
    return {
      status: "down",
      latencyMs: 0,
      error: "WebSocket is not available in this runtime",
    }
  }

  const url = normalizeGatewaySocketUrl(gatewayUrl)
  const startMs = Date.now()

  return new Promise((resolve) => {
    let settled = false
    let timeoutHandle: NodeJS.Timeout | null = null

    const finalize = (status: HealthStatus, error?: string) => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      resolve({
        status,
        latencyMs: Date.now() - startMs,
        ...(error ? { error } : {}),
      })
    }

    try {
      const socket = new WebSocket(url)
      socket.addEventListener("open", () => {
        socket.close()
        finalize("up")
      })
      socket.addEventListener("error", () => {
        finalize("down", "socket_error")
      })

      timeoutHandle = setTimeout(() => {
        socket.close()
        finalize("down", "socket_timeout")
      }, SOCKET_HEALTH_TIMEOUT_MS)
      timeoutHandle.unref?.()
    } catch (error) {
      finalize("down", error instanceof Error ? error.message : "Unknown error")
    }
  })
}

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error")

export async function GET() {
  let env

  try {
    env = getServerEnvConfig()
  } catch (error) {
    return NextResponse.json(
      { status: "degraded", timestamp: new Date().toISOString(), error: getErrorMessage(error) },
      { status: 500 }
    )
  }

  const [elevenLabs, openClawSocket, openClawHttp] = await Promise.all([
    checkDependency("https://api.elevenlabs.io/v1/user", {
      "xi-api-key": env.ELEVENLABS_API_KEY,
    }),
    checkGatewaySocket(env.OPENCLAW_GATEWAY_URL),
    checkDependency(buildGatewayHttpUrl(env.OPENCLAW_GATEWAY_URL, "/models"), {
      Authorization: `Bearer ${env.OPENCLAW_GATEWAY_TOKEN}`,
      "Content-Type": "application/json",
    }),
  ])

  const openClaw = openClawSocket.status === "up" ? openClawSocket : openClawHttp

  const startupChecks = {
    elevenLabs,
    openClaw,
  }

  const healthy = Object.values(startupChecks).every((dependency) => dependency.status === "up")

  const payload: StartupHealthPayload = {
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: startupChecks,
  }

  return NextResponse.json(payload, { status: healthy ? 200 : 503 })
}
