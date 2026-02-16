import { z } from "zod"

const parseBoolean = (value: unknown) => {
  if (value === undefined || value === "") {
    return undefined
  }

  if (typeof value === "boolean") {
    return value
  }

  if (typeof value !== "string") {
    return value
  }

  const normalized = value.trim().toLowerCase()
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false
  }

  return undefined
}

const parseNumber = (value: unknown) => {
  if (value === undefined || value === "") {
    return 60
  }

  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return value
}

const parseLogLevel = (value: unknown) => {
  if (typeof value !== "string") {
    return value
  }

  return value.trim().toLowerCase()
}

const parseOptionalString = (value: unknown) => {
  if (typeof value !== "string") {
    return value
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

const parseOptionalPositiveInt = (value: unknown) => {
  if (value === undefined || value === "") {
    return undefined
  }
  return parseNumber(value)
}

const parseOptionalNumber = (value: unknown) => {
  if (value === undefined || value === "") {
    return undefined
  }

  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim())
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return value
}

const websocketUrl = (value: string) => {
  const trimmed = value.trim()
  return trimmed.startsWith("ws://") || trimmed.startsWith("wss://")
}

const envSchema = z.object({
  ELEVENLABS_API_KEY: z
    .string({ required_error: "ELEVENLABS_API_KEY is required" })
    .trim()
    .min(1, "ELEVENLABS_API_KEY is required"),
  ELEVENLABS_VOICE_ID: z
    .string({ required_error: "ELEVENLABS_VOICE_ID is required" })
    .trim()
    .min(1, "ELEVENLABS_VOICE_ID is required"),
  OPENCLAW_GATEWAY_URL: z
    .string({ required_error: "OPENCLAW_GATEWAY_URL is required" })
    .trim()
    .url("OPENCLAW_GATEWAY_URL must be a valid URL")
    .refine(websocketUrl, {
      message: "OPENCLAW_GATEWAY_URL must be a ws:// or wss:// URL",
    }),
  OPENCLAW_GATEWAY_TOKEN: z
    .string({ required_error: "OPENCLAW_GATEWAY_TOKEN is required" })
    .trim()
    .min(1, "OPENCLAW_GATEWAY_TOKEN is required"),
  OPENCLAW_APP_NAME: z
    .string({ required_error: "OPENCLAW_APP_NAME is required" })
    .trim()
    .min(1, "OPENCLAW_APP_NAME is required")
    .default("openclaw-hal-assistant"),
  OPENCLAW_GATEWAY_USERNAME: z
    .string()
    .trim()
    .min(1, "OPENCLAW_GATEWAY_USERNAME is required")
    .default("default-user"),
  OPENCLAW_SESSION_ID: z
    .string()
    .trim()
    .uuid("OPENCLAW_SESSION_ID must be a valid UUID")
    .optional(),
  OPENCLAW_DEFAULT_AGENT_MODEL: z.preprocess(
    parseOptionalString,
    z.string().trim().min(1).optional()
  ),
  OPENCLAW_WAKE_WORD_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(true)
  ),
  OPENCLAW_WAKE_WORD: z
    .string()
    .trim()
    .min(1, "OPENCLAW_WAKE_WORD is required")
    .default("hey luke"),
  OPENCLAW_TEXT_TRANSLATIONS_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(true)
  ),
  OPENCLAW_WAKE_WORD_ACCESS_KEY: z.preprocess(
    parseOptionalString,
    z.string().trim().min(1).optional()
  ),
  OPENCLAW_WAKE_WORD_MODEL_PATH: z.preprocess(
    parseOptionalString,
    z.string().trim().min(1).optional()
  ),
  OPENCLAW_WAKE_WORD_KEYWORD_PATH: z.preprocess(
    parseOptionalString,
    z.string().trim().min(1).optional()
  ),
  OPENCLAW_WAKE_WORD_SENSITIVITY: z.preprocess(
    parseOptionalNumber,
    z.number().min(0).max(1).optional()
  ),
  OPENCLAW_AGENT_ID: z
    .string()
    .trim()
    .min(1, "OPENCLAW_AGENT_ID must not be empty")
    .default("main"),
  OPENCLAW_API_DOCS_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(false)
  ),
  OPENCLAW_API_DOCS_TOKEN: z
    .string()
    .trim()
    .optional(),
  OPENCLAW_API_KEY: z
    .string()
    .trim()
    .optional(),
  OPENCLAW_RATE_LIMIT: z.preprocess(
    parseNumber,
    z.number({ invalid_type_error: "OPENCLAW_RATE_LIMIT must be a positive number" })
      .int()
      .positive()
      .default(60)
  ),
  OPENCLAW_GATEWAY_TIMEOUT_MS: z.preprocess(
    parseOptionalPositiveInt,
    z
      .number({ invalid_type_error: "OPENCLAW_GATEWAY_TIMEOUT_MS must be a positive number" })
      .int()
      .positive()
      .default(120_000)
  ),
  OPENCLAW_CHAT_REQUEST_TIMEOUT_MS: z.preprocess(
    parseOptionalPositiveInt,
    z
      .number({ invalid_type_error: "OPENCLAW_CHAT_REQUEST_TIMEOUT_MS must be a positive number" })
      .int()
      .positive()
      .optional()
  ),
  OPENCLAW_GATEWAY_MAX_RETRY_ATTEMPTS: z.preprocess(
    parseOptionalPositiveInt,
    z
      .number({
        invalid_type_error: "OPENCLAW_GATEWAY_MAX_RETRY_ATTEMPTS must be a positive number",
      })
      .int()
      .positive()
      .default(3)
  ),
  LOG_LEVEL: z.preprocess(
    parseLogLevel,
    z.enum(["error", "warn", "info", "debug"]).default("info")
  ),
})

const warnIfDeprecatedWakeEnginePresent = (env: NodeJS.ProcessEnv) => {
  if (typeof env.OPENCLAW_WAKE_ENGINE === "string" && env.OPENCLAW_WAKE_ENGINE.trim().length > 0) {
    console.warn(
      "Deprecated env OPENCLAW_WAKE_ENGINE detected; wake engine is now Porcupine-only. Remove this variable."
    )
  }
}

export type EnvConfig = z.infer<typeof envSchema>

export function getServerEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  warnIfDeprecatedWakeEnginePresent(env)
  const result = envSchema.safeParse(env)
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n")
    throw new Error(`Environment validation failed:\n${errors}`)
  }
  return {
    ...result.data,
    OPENCLAW_CHAT_REQUEST_TIMEOUT_MS:
      result.data.OPENCLAW_CHAT_REQUEST_TIMEOUT_MS ??
      result.data.OPENCLAW_GATEWAY_TIMEOUT_MS ??
      120_000,
  }
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env) {
  warnIfDeprecatedWakeEnginePresent(env)
  const result = envSchema.safeParse(env)

  if (!result.success) {
    return {
      success: false as const,
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      ),
    }
  }

  return {
    success: true as const,
    config: {
      ...result.data,
      OPENCLAW_CHAT_REQUEST_TIMEOUT_MS:
        result.data.OPENCLAW_CHAT_REQUEST_TIMEOUT_MS ??
        result.data.OPENCLAW_GATEWAY_TIMEOUT_MS ??
        120_000,
    },
  }
}
