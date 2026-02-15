import { z } from "zod"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const loadEnvFile = (filename = ".env") => {
  const envPath = resolve(process.cwd(), filename)
  if (!existsSync(envPath)) {
    return
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/)
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const delimiterIndex = trimmed.indexOf("=")
    if (delimiterIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, delimiterIndex).trim()
    let value = trimmed.slice(delimiterIndex + 1).trim()

    if (
      (value.startsWith(`"`) && value.endsWith(`"`)) ||
      (value.startsWith(`'`) && value.endsWith(`'`))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnvFile()

const parseBoolean = (value) => {
  if (value === undefined || value === "") {
    return false
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

  return value
}

const parseNumber = (value) => {
  if (value === undefined || value === "") {
    return 60
  }

  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return value
}

const parseLogLevel = (value) => {
  if (typeof value !== "string") {
    return value
  }

  return value.trim().toLowerCase()
}

const schema = z.object({
  ELEVENLABS_API_KEY: z
    .string({ required_error: "ELEVENLABS_API_KEY is required" })
    .trim()
    .min(1),
  ELEVENLABS_VOICE_ID: z
    .string({ required_error: "ELEVENLABS_VOICE_ID is required" })
    .trim()
    .min(1),
  OPENCLAW_GATEWAY_URL: z
    .string({ required_error: "OPENCLAW_GATEWAY_URL is required" })
    .trim()
    .url("OPENCLAW_GATEWAY_URL must be a valid URL"),
  OPENCLAW_GATEWAY_TOKEN: z
    .string({ required_error: "OPENCLAW_GATEWAY_TOKEN is required" })
    .trim()
    .min(1),
  OPENCLAW_AGENT_ID: z.string().trim().min(1, "OPENCLAW_AGENT_ID must not be empty").default("main"),
  OPENCLAW_API_DOCS_ENABLED: z.preprocess(parseBoolean, z.boolean()),
  OPENCLAW_API_DOCS_TOKEN: z.string().trim().optional(),
  OPENCLAW_API_KEY: z.string().trim().optional(),
  OPENCLAW_RATE_LIMIT: z.preprocess(
    parseNumber,
    z.number({ invalid_type_error: "OPENCLAW_RATE_LIMIT must be a positive number" }).int().positive().default(60)
  ),
  LOG_LEVEL: z.preprocess(parseLogLevel, z.enum(["error", "warn", "info", "debug"]).default("info")),
})

const result = schema.safeParse(process.env)

if (!result.success) {
  console.error("Environment validation failed")
  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`)
  }
  process.exit(1)
}

console.log("Environment configuration is valid.")
