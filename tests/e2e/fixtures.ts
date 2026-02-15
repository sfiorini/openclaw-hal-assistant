import type { Page } from "@playwright/test"

type BrowserApiFixtureOptions = {
  sttText?: string
  chatText?: string
  audioHex?: string
}

const parseHexBytes = (value: string) => {
  const bytes = value.trim().replace(/^0x/, "")

  if (bytes.length === 0) {
    return [73, 68, 51]
  }

  const normalized = bytes.length % 2 === 1 ? `0${bytes}` : bytes

  return Array.from(normalized.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16))
}

export const installBrowserApiMocks = async (
  page: Page,
  options: BrowserApiFixtureOptions = {}
) => {
  const sttText = options.sttText ?? "what is the weather"
  const chatText = options.chatText ?? "OpenClaw reports clear skies."
  const audioHex = options.audioHex ?? "494433"

  await page.addInitScript(
    ({ sttText: injectedSttText, chatText: injectedChatText, audioHex: injectedAudioHex }) => {
      const randomIp = () => `e2e-${Math.floor(Math.random() * 1_000_000)}`
      const mockAudio = new Uint8Array(
        injectedAudioHex.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [73, 68, 51, 3, 0, 0, 0]
      )

      const mockModelsResponse = { data: [{ id: "main" }] }
      const mockSttResponse = { text: injectedSttText }
      const mockChatSubmissionResponse = {
        jobId: "e2e-mock-chat-job",
        status: "queued" as const,
        pollAfterMs: 500,
        maxPollAttempts: 20,
        maxWaitMs: 10000,
      }
      const mockChatTerminalResponse = {
        jobId: "e2e-mock-chat-job",
        status: "completed" as const,
        pollAfterMs: 0,
        attemptCount: 2,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        response: {
          text: injectedChatText,
          conversationHistory: [
            { role: "user", content: "what is the weather" },
            { role: "assistant", content: injectedChatText },
          ],
        },
      }

      const mockChatJobPollState = {
        attempts: 0,
      }

      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input, init = {}) => {
        const requestInfo =
          input instanceof Request ? input.url : typeof input === "string" ? input : String(input)
        const url = new URL(requestInfo, window.location.href)
        const requestHeaders = input instanceof Request
          ? new Headers(input.headers)
          : new Headers((init as RequestInit).headers)

        if (!requestHeaders.has("x-forwarded-for")) {
          requestHeaders.set("x-forwarded-for", randomIp())
        }

        const initRequest: RequestInit = {
          ...init,
          headers: requestHeaders,
        }

        if (url.pathname.startsWith("/api/stt")) {
          return Response.json(mockSttResponse, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }

        if (url.pathname.startsWith("/api/tts")) {
          return new Response(mockAudio, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Content-Length": String(mockAudio.byteLength),
            },
          })
        }

        if (url.pathname === "/api/chat" || url.pathname === "/api/chat/") {
          mockChatJobPollState.attempts = 0
          return Response.json(mockChatSubmissionResponse, {
            status: 202,
            headers: { "Content-Type": "application/json" },
          })
        }

        if (url.pathname.startsWith("/api/chat/jobs/")) {
          mockChatJobPollState.attempts += 1
          let pollPayload: Record<string, unknown>

          if (mockChatJobPollState.attempts < 2) {
            pollPayload = {
              ...mockChatTerminalResponse,
              status: "running",
              startedAt: new Date().toISOString(),
              pollAfterMs: 250,
            }
          } else {
            pollPayload = mockChatTerminalResponse
          }

          return Response.json(pollPayload, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }

        if (url.pathname === "/v1/models") {
          return Response.json(mockModelsResponse, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }

        return originalFetch(input, initRequest)
      }

      const trackState = {
        stop() {},
      }

      class MockMediaStream {
        getTracks() {
          return [trackState]
        }
      }

      class MockMediaRecorder {
        static isTypeSupported() {
          return true
        }

        state: "inactive" | "recording" = "inactive"
        ondataavailable: ((event: BlobEvent) => void) | null = null
        onstop: (() => void) | null = null

        constructor(_stream: MockMediaStream) {}

        start() {
          this.state = "recording"
        }

        stop() {
          if (this.state !== "recording") {
            return
          }

          this.state = "inactive"
          this.ondataavailable?.({
            data: new Blob([new Uint8Array([1, 2, 3])]),
          } as BlobEvent)
          this.onstop?.()
        }
      }

      if (!("mediaDevices" in navigator)) {
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {},
        })
      }

      const navigatorWithMedia = navigator as Navigator & {
        mediaDevices: MediaDevices & { getUserMedia: () => Promise<MockMediaStream> }
      }
      Object.defineProperty(navigatorWithMedia.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => new MockMediaStream(),
      })
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: MockMediaRecorder,
      })

      URL.createObjectURL = () => "mock:audio"
      URL.revokeObjectURL = () => {}

      class MockAudio {
        onended: ((event: Event) => void) | null = null
        onerror: ((event: Event) => void) | null = null
        constructor(public src: string) {}

        pause() {}

        play() {
          window.setTimeout(() => {
            if (this.onended) {
              this.onended(new Event("ended"))
            }
          }, 2500)

          return Promise.resolve()
        }
      }

      ;(window as Window & { Audio: typeof MockAudio }).Audio = MockAudio as typeof Audio
    },
    {
      sttText,
      chatText,
      audioHex: parseHexBytes(audioHex).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    }
  )
}

export const buildHeaders = (ip: string) => ({
  "x-forwarded-for": ip,
})
