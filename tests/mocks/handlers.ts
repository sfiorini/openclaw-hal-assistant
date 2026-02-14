import { http, HttpResponse } from "msw"

const elevenLabsSpeechEndpoint = "https://api.elevenlabs.io/v1/speech-to-text"
const elevenLabsTtsEndpoint = "https://api.elevenlabs.io/v1/text-to-speech/:voiceId"
const openClawChatEndpoint = /.*\/v1\/chat\/completions$/

const audioBuffer = new Uint8Array([1, 2, 3, 4])

export const handlers = [
  http.post(elevenLabsSpeechEndpoint, () => {
    return HttpResponse.json({ text: "mocked transcription" })
  }),

  http.post(elevenLabsTtsEndpoint, () => {
    return new HttpResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
      },
    })
  }),

  http.post(openClawChatEndpoint, async ({ request }) => {
    const payload = (await request.json().catch(() => ({}))) as {
      messages?: Array<{ role: string; content?: string }>
      message?: string
    }

    const latestMessage =
      payload?.messages?.[payload.messages.length - 1]?.content ?? payload?.message ?? "Hello"

    return HttpResponse.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: `Mock reply for: ${latestMessage}`,
          },
        },
      ],
    })
  }),
]
