import { beforeEach, describe, expect, it } from "vitest"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { NextRequest } from "next/server"

import { GET as GET_OPENAPI } from "../../app/api/openapi/route"
import { GET as GET_DOCS } from "../../app/api/docs/route"

const baseEnv = {
  OPENCLAW_API_DOCS_ENABLED: "true",
  OPENCLAW_API_DOCS_TOKEN: "docs-token",
  ELEVENLABS_API_KEY: "eleven-key",
  ELEVENLABS_VOICE_ID: "voice-id",
  OPENCLAW_GATEWAY_URL: "https://gateway.example.com",
  OPENCLAW_GATEWAY_TOKEN: "gateway-token",
}

const writeOpenApiFixture = async (spec: Record<string, unknown> = { openapi: "3.0.0", paths: {} }) => {
  await writeFile(join(process.cwd(), "public", "openapi.json"), `${JSON.stringify(spec, null, 2)}\n`)
}

const createRequest = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/openapi", {
    headers,
  }) as unknown as NextRequest

const setEnv = () => {
  Object.entries(baseEnv).forEach(([key, value]) => {
    process.env[key] = value
  })
}

describe("OpenAPI and docs", () => {
  beforeEach(async () => {
    setEnv()
    await writeOpenApiFixture({
      openapi: "3.0.0",
      info: { title: "OpenClaw HAL", version: "1.0.0" },
      paths: {
        "/api/chat": { post: {} },
        "/api/stt": {
          post: {
            requestBody: {
              content: {
                "multipart/form-data": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
        "/api/tts": { post: {} },
      },
    })
  })

  it("returns generated OpenAPI JSON when docs are enabled", async () => {
    const response = await GET_OPENAPI(
      createRequest({
        "x-api-docs-token": "docs-token",
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
      expect(payload.openapi).toBe("3.0.0")
      expect(payload.paths["/api/chat"]).toBeDefined()
      expect(payload.paths["/api/stt"]).toBeDefined()
      expect(payload.paths["/api/tts"]).toBeDefined()
      expect(payload.paths["/api/stt"].post.requestBody.content["multipart/form-data"]).toBeDefined()
  })

  it("returns 404 for openapi when docs are disabled", async () => {
    process.env.OPENCLAW_API_DOCS_ENABLED = "false"

    const response = await GET_OPENAPI(createRequest())

    expect(response.status).toBe(404)
  })

  it("requires token when docs token is configured", async () => {
    const responseWithoutToken = await GET_DOCS(createRequest())
    expect(responseWithoutToken.status).toBe(401)

    const responseWithWrongToken = await GET_DOCS(createRequest({ "x-api-docs-token": "wrong" }))
    expect(responseWithWrongToken.status).toBe(401)

    const responseWithToken = await GET_DOCS(createRequest({ "x-api-docs-token": "docs-token" }))
    expect(responseWithToken.status).toBe(200)
    expect(await responseWithToken.text()).toContain("swagger-ui")
  })

  it("returns 404 when docs disabled", async () => {
    process.env.OPENCLAW_API_DOCS_ENABLED = "false"

    const response = await GET_DOCS(createRequest())

    expect(response.status).toBe(404)
  })
})
