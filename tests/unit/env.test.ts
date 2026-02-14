import { describe, expect, it } from "vitest"

import { getServerEnvConfig, validateEnv } from "../../lib/config/env"

const requiredEnv = {
  ELEVENLABS_API_KEY: "eleven-key",
  ELEVENLABS_VOICE_ID: "voice-id",
  OPENCLAW_GATEWAY_URL: "https://gateway.example.com",
  OPENCLAW_GATEWAY_TOKEN: "gateway-token",
}

const createEnv = (overrides: Record<string, string | undefined> = {}) => ({
  ...requiredEnv,
  ...overrides,
})

describe("getServerEnvConfig", () => {
  it("throws when a required variable is missing", () => {
    expect(() =>
      getServerEnvConfig(
        createEnv({
          ELEVENLABS_API_KEY: undefined,
        })
      )
    ).toThrow("ELEVENLABS_API_KEY is required")
  })

  it("applies defaults for optional variables", () => {
    const config = getServerEnvConfig(createEnv())
    expect(config.OPENCLAW_AGENT_ID).toBe("main")
    expect(config.OPENCLAW_RATE_LIMIT).toBe(60)
    expect(config.LOG_LEVEL).toBe("info")
    expect(config.OPENCLAW_API_DOCS_ENABLED).toBe(false)
  })

  it("throws when OPENCLAW_GATEWAY_URL is not a valid URL", () => {
    expect(() =>
      getServerEnvConfig(
        createEnv({
          OPENCLAW_GATEWAY_URL: "not-a-url",
        })
      )
    ).toThrow("OPENCLAW_GATEWAY_URL must be a valid URL")
  })
})

describe("validateEnv", () => {
  it("returns success for valid environment", () => {
    const result = validateEnv(createEnv())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.config.OPENCLAW_AGENT_ID).toBe("main")
    }
  })

  it("returns detailed errors for invalid environment", () => {
    const result = validateEnv(
      createEnv({
        OPENCLAW_GATEWAY_URL: "bad",
        OPENCLAW_RATE_LIMIT: "abc",
      })
    )

    expect(result.success).toBe(false)
    expect(result.errors).toContain(
      "OPENCLAW_GATEWAY_URL: OPENCLAW_GATEWAY_URL must be a valid URL"
    )
    expect(result.errors.some((entry) => entry.includes("OPENCLAW_RATE_LIMIT"))).toBe(true)
  })
})
