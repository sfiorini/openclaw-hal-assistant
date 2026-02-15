import { expect, test } from "@playwright/test"

import { buildHeaders } from "./fixtures"

test.describe("API direct usage", () => {
  const pollForCompletion = async (requestClient: typeof request, jobId: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const poll = await requestClient.get(`/api/chat/jobs/${jobId}`)
      expect(poll.status()).toBe(200)
      const payload = await poll.json()
      if (payload.status === "completed") {
        return payload
      }
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new Error(`Chat job did not complete: ${payload.status}`)
      }

      await requestClient.waitForTimeout(100)
    }

    throw new Error("Chat job never completed")
  }

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

    expect(chatResponse.status()).toBe(202)
      const chatPayload = await chatResponse.json()
      expect(chatPayload.status).toBe("queued")
      expect(typeof chatPayload.jobId).toBe("string")

      const completed = await pollForCompletion(request, chatPayload.jobId)
      expect(completed.response.text).toBe("Mocked response from OpenClaw.")
      expect(Array.isArray(completed.response.conversationHistory)).toBeTruthy()
      expect(completed.response.conversationHistory).toHaveLength(3)

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

    expect(first.status()).toBe(202)
    expect(second.status()).toBe(202)
    expect(third.status()).toBe(429)
    const payloadBody = await third.json()
    expect(payloadBody.error).toBe("Too many requests")
  })
})
