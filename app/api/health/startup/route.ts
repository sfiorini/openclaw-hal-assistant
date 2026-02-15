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
  _name: string,
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

  const [elevenLabs, openClaw] = await Promise.all([
    checkDependency("elevenLabs", "https://api.elevenlabs.io/v1/user", {
      "xi-api-key": env.ELEVENLABS_API_KEY,
    }),
    checkDependency("openClaw", `${env.OPENCLAW_GATEWAY_URL}/v1/models`, {
      Authorization: `Bearer ${env.OPENCLAW_GATEWAY_TOKEN}`,
      "Content-Type": "application/json",
    }),
  ])

  const startupChecks = {
    elevenLabs: elevenLabs,
    openClaw: openClaw,
  }

  const healthy = Object.values(startupChecks).every((dependency) => dependency.status === "up")

  const payload: StartupHealthPayload = {
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: startupChecks,
  }

  return NextResponse.json(payload, { status: healthy ? 200 : 503 })
}
