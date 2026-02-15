import { expect, test } from "@playwright/test"

import { buildHeaders } from "./fixtures"

test.describe("API direct usage", () => {
  test("returns STT, chat, and TTS responses", async ({ request }) => {
    const sttIp = "198.51.100.10"
    const chatIp = "198.51.100.11"
    const ttsIp = "198.51.100.12"

    const sttResponse = await request.post("/api/stt", {
      headers: {
        ...buildHeaders(sttIp),
      },
      multipart: {
        audio: {
          name: "speech.wav",
          mimeType: "audio/wav",
          buffer: Buffer.from([0x11, 0x22, 0x33]),
        },
      },
    })

    expect(sttResponse.status()).toBe(200)
    await expect(sttResponse.ok()).toBeTruthy()
    const sttPayload = await sttResponse.json()
    expect(sttPayload.text).toBe("what is the weather")

    const chatResponse = await request.post("/api/chat", {
      headers: {
        ...buildHeaders(chatIp),
        "content-type": "application/json",
      },
      data: JSON.stringify({
        message: "Hello HAL",
        conversationHistory: [{ role: "user", content: "Previous context" }],
      }),
    })

    expect(chatResponse.status()).toBe(200)
    const chatPayload = await chatResponse.json()
    expect(chatPayload.text).toBe("Mocked response from OpenClaw.")
    expect(Array.isArray(chatPayload.conversationHistory)).toBeTruthy()
    expect(chatPayload.conversationHistory).toHaveLength(2)

    const ttsResponse = await request.post("/api/tts", {
      headers: {
        ...buildHeaders(ttsIp),
        "content-type": "application/json",
      },
      data: JSON.stringify({ text: "Turn lights down" }),
    })

    expect(ttsResponse.status()).toBe(200)
    expect(ttsResponse.headers()["content-type"]).toContain("audio/mpeg")
    const audio = await ttsResponse.body()
    expect(audio.byteLength).toBeGreaterThan(0)
  })

  test("enforces rate limit by IP", async ({ request }) => {
    const sharedIp = "203.0.113.15"
    const payload = { message: "Hello", conversationHistory: [] }

    const first = await request.post("/api/chat", {
      headers: {
        ...buildHeaders(sharedIp),
        "content-type": "application/json",
      },
      data: JSON.stringify(payload),
    })

    const second = await request.post("/api/chat", {
      headers: {
        ...buildHeaders(sharedIp),
        "content-type": "application/json",
      },
      data: JSON.stringify(payload),
    })

    const third = await request.post("/api/chat", {
      headers: {
        ...buildHeaders(sharedIp),
        "content-type": "application/json",
      },
      data: JSON.stringify(payload),
    })

    expect(first.status()).toBe(200)
    expect(second.status()).toBe(200)
    expect(third.status()).toBe(429)
    const payloadBody = await third.json()
    expect(payloadBody.error).toBe("Too many requests")
  })
})
