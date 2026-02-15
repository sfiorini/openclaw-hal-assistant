import { beforeEach, describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"

import { chatWithOpenClaw, mapOpenClawError } from "../../lib/openclaw/chat"
import { server } from "../mocks/server"

describe("chatWithOpenClaw", () => {
  beforeEach(() => {
    server.use(
      http.post(/.*\/v1\/chat\/completions$/, () => {
        return HttpResponse.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Mapped response",
              },
            },
          ],
        })
      })
    )
  })

  it("maps assistant text to chat result", async () => {
    const result = await chatWithOpenClaw({
      message: "hello",
      conversationHistory: [],
      gatewayUrl: "https://gateway.example.com",
      gatewayToken: "token",
      agentId: "agent-id",
    })

    expect(result.text).toBe("Mapped response")
    expect(result.conversationHistory.at(-1)?.content).toBe("Mapped response")
  })

  it("forwards session identifiers to upstream gateway payload", async () => {
    let capturedBody: Record<string, unknown> = {}
    let capturedSessionHeader: string | null = null

    server.use(
      http.post(/.*\/v1\/chat\/completions$/, async ({ request }) => {
        capturedSessionHeader = request.headers.get("x-openclaw-session-key")
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Mapped response",
              },
            },
          ],
        })
      })
    )

    await chatWithOpenClaw({
      message: "hello",
      conversationHistory: [{ role: "user", content: "context" }],
      gatewayUrl: "https://gateway.example.com",
      gatewayToken: "token",
      agentId: "agent-id",
      sessionId: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
    })

    expect(capturedSessionHeader).toBe("f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2")
    expect(capturedBody).toMatchObject({
      user: "f81c1f8a-9f7c-4e95-9e8c-cfd1f9b3c8f2",
    })
  })

  it("throws a classified error on upstream status failure", async () => {
    server.use(
      http.post(/.*\/v1\/chat\/completions$/, () =>
        HttpResponse.json({ error: "failed" }, { status: 500 })
      )
    )

    await expect(() =>
      chatWithOpenClaw({
        message: "hello",
        conversationHistory: [],
        gatewayUrl: "https://gateway.example.com",
        gatewayToken: "token",
        agentId: "agent-id",
      })
    ).rejects.toMatchObject({
      code: "upstream_error",
      name: "OpenClawChatError",
    })
  })

  it("maps timeout errors to timeout code", async () => {
    const mapped = mapOpenClawError(new DOMException("Operation timed out", "TimeoutError"))
    expect(mapped.code).toBe("timeout")
    expect(mapped.message).toBe("Upstream request timed out")
  })

  it("maps generic Error to server_error", async () => {
    const mapped = mapOpenClawError(new Error("Network down"))
    expect(mapped.code).toBe("server_error")
    expect(mapped.message).toBe("Network down")
  })

  it("maps unexpected upstream values to server_error", async () => {
    const mapped = mapOpenClawError({ reason: "mystery" })
    expect(mapped.code).toBe("server_error")
    expect(mapped.message).toBe("Unexpected upstream failure")
  })
})
