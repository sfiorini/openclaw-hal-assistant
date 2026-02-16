import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { createPorcupineWakeEngineMock } = vi.hoisted(() => ({
  createPorcupineWakeEngineMock: vi.fn(),
}))

vi.mock("../../lib/wake/porcupine-wake-engine", () => ({
  createPorcupineWakeEngine: createPorcupineWakeEngineMock,
}))

import { useVoiceAssistant } from "../../hooks/use-voice-assistant"

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = []

  continuous = false
  interimResults = false
  lang = "en-US"
  onresult: ((event: { results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }> }) => void) | null = null
  onerror: ((event: { error?: unknown }) => void) | null = null
  onend: (() => void) | null = null

  readonly start = vi.fn()
  readonly stop = vi.fn()

  constructor() {
    MockSpeechRecognition.instances.push(this)
  }

  static reset() {
    MockSpeechRecognition.instances = []
  }
}

class MockAudio {
  onended: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(public src: string) {}

  pause() {}

  play() {
    return Promise.resolve()
  }
}

const createMediaStream = () => ({
  getTracks: () => [{ stop: vi.fn() }],
})

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true)

  public ondataavailable: ((event: { data: Blob }) => void) | null = null
  public onstop: (() => void) | null = null
  public state: "inactive" | "recording" = "inactive"

  constructor() {}

  start() {
    this.state = "recording"
  }

  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) })
    this.onstop?.()
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  MockSpeechRecognition.reset()
  createPorcupineWakeEngineMock.mockReset()

  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: MockSpeechRecognition,
  })
  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    value: MockSpeechRecognition,
  })

  Object.defineProperty(globalThis, "webkitSpeechRecognition", {
    configurable: true,
    value: undefined,
  })
  Object.defineProperty(window, "webkitSpeechRecognition", {
    configurable: true,
    value: undefined,
  })

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => createMediaStream()),
    },
  })

  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: MockMediaRecorder,
  })

  Object.defineProperty(window, "Audio", {
    configurable: true,
    value: MockAudio,
  })

  vi.spyOn(window.URL, "createObjectURL").mockReturnValue("mock:audio")
  vi.spyOn(window.URL, "revokeObjectURL").mockReturnValue()
})

describe("useVoiceAssistant wake-word behavior", () => {
  it("detects wake phrase and starts recording", async () => {
    const { result } = renderHook(() => useVoiceAssistant({ wakeWord: "hey luke", wakeWordEnabled: true }))

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    })

    await waitFor(() => {
      expect(MockSpeechRecognition.instances[0]).toBeTruthy()
    })

    const instance = MockSpeechRecognition.instances[0]

    act(() => {
      instance.onresult?.({
        results: [{
          isFinal: true,
          0: {
            transcript: "please hey luke assistant",
          },
        }],
      })
    })

    await waitFor(() => {
      expect(result.current.state).toBe("recording")
    })
  })

  it("supports manual mode when wake recognition is unavailable", async () => {
    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    })

    const { result } = renderHook(() => useVoiceAssistant({ wakeWordEnabled: true }))

    expect(result.current.wakeWordSupported).toBe(false)

    act(() => {
      result.current.toggleRecording()
    })

    await waitFor(() => {
      expect(result.current.state).toBe("recording")
    })
  })

  it("starts local porcupine wake engine when configured", async () => {
    const engine = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
      isRunning: vi.fn(() => false),
    }

    createPorcupineWakeEngineMock.mockResolvedValue(engine)

    renderHook(() =>
      useVoiceAssistant({
        wakeWordEnabled: true,
        wakeWord: "hey luke",
        wakeEngine: "porcupine",
        wakeWordAccessKey: "test-access-key",
        wakeWordModelPath: "/porcupine_params.pv",
        wakeWordKeywordPath: "/keywords/hey-luke.ppn",
      })
    )

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    })

    await waitFor(() => {
      expect(createPorcupineWakeEngineMock).toHaveBeenCalledTimes(1)
      expect(engine.start).toHaveBeenCalledTimes(1)
    })
  })
})
