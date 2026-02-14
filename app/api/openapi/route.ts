import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { getServerEnvConfig } from "../../../lib/config/env"

const SPEC_PATH = join(process.cwd(), "public", "openapi.json")

export async function GET(request: NextRequest) {
  let env

  try {
    env = getServerEnvConfig()
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }

  if (!env.OPENCLAW_API_DOCS_ENABLED) {
    return NextResponse.json({ error: "API docs are disabled" }, { status: 404 })
  }

  if (env.OPENCLAW_API_DOCS_TOKEN && request.headers.get("x-api-docs-token") !== env.OPENCLAW_API_DOCS_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const raw = await readFile(SPEC_PATH, "utf8")
    const spec = JSON.parse(raw)
    return NextResponse.json(spec)
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to load OpenAPI spec: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
