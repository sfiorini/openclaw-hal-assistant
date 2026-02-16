import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { createPorcupineWakeEngineMock } = vi.hoisted(() => ({
  createPorcupineWakeEngineMock: vi.fn(),
}))

vi.mock("../../lib/wake/porcupine-wake-engine", () => ({
  createPorcupineWakeEngine: createPorcupineWakeEngineMock,
}))

import { useVoiceAssistant } from "../../hooks/use-voice-assistant"

const TRANSLATION_VISIBILITY_STORAGE_KEY = "openclaw_show_translations"

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
  createPorcupineWakeEngineMock.mockReset()
  window.localStorage.clear()

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
  it("supports manual mode when porcupine wake is not configured", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { result } = renderHook(() => useVoiceAssistant({ wakeWordEnabled: true }))

    expect(result.current.wakeWordSupported).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      "Wake word disabled: Porcupine access key or model path not configured. Manual recording mode active."
    )

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

describe("useVoiceAssistant translation visibility", () => {
  it("defaults translations to visible when enabled", () => {
    const { result } = renderHook(() =>
      useVoiceAssistant({ wakeWordEnabled: false, textTranslationsEnabled: true })
    )

    expect(result.current.textTranslationsEnabled).toBe(true)
    expect(result.current.showTranslations).toBe(true)
  })

  it("toggles translation visibility and persists to localStorage", () => {
    const { result } = renderHook(() =>
      useVoiceAssistant({ wakeWordEnabled: false, textTranslationsEnabled: true })
    )

    act(() => {
      result.current.toggleTranslationsVisibility()
    })

    expect(result.current.showTranslations).toBe(false)
    expect(window.localStorage.getItem(TRANSLATION_VISIBILITY_STORAGE_KEY)).toBe("0")
  })

  it("forces translations hidden when env disables them", () => {
    window.localStorage.setItem(TRANSLATION_VISIBILITY_STORAGE_KEY, "1")
    const { result } = renderHook(() =>
      useVoiceAssistant({ wakeWordEnabled: false, textTranslationsEnabled: false })
    )

    expect(result.current.textTranslationsEnabled).toBe(false)
    expect(result.current.showTranslations).toBe(false)

    act(() => {
      result.current.toggleTranslationsVisibility()
    })

    expect(result.current.showTranslations).toBe(false)
  })
})
