import { describe, expect, it, vi } from "vitest"

import { createPorcupineWakeEngine } from "../../lib/wake/porcupine-wake-engine"

type BuiltInKeywordMap = Record<string, string>

const createDeps = () => {
  const subscribe = vi.fn(async () => undefined)
  const unsubscribe = vi.fn(async () => undefined)
  const createWorker = vi.fn(async () => ({
    release: vi.fn(async () => undefined),
    terminate: vi.fn(() => undefined),
  }))

  const builtInKeywords: BuiltInKeywordMap = {
    Porcupine: "Porcupine",
    Computer: "Computer",
  }

  const deps = {
    loadPorcupine: vi.fn(async () => ({
      PorcupineWorker: {
        create: createWorker,
      },
      BuiltInKeyword: builtInKeywords,
    })),
    loadWebVoiceProcessor: vi.fn(async () => ({
      WebVoiceProcessor: {
        subscribe,
        unsubscribe,
      },
    })),
  }

  return {
    deps,
    createWorker,
    subscribe,
    unsubscribe,
    builtInKeywords,
  }
}

describe("createPorcupineWakeEngine", () => {
  it("creates and subscribes using a built-in keyword mapping", async () => {
    const { deps, createWorker, subscribe, unsubscribe } = createDeps()
    const engine = await createPorcupineWakeEngine(
      {
        accessKey: "test-access-key",
        wakeWord: "porcupine",
        modelPath: "/porcupine_params.pv",
      },
      deps
    )

    await engine.start()
    await engine.stop()

    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(createWorker).toHaveBeenCalledWith(
      "test-access-key",
      "Porcupine",
      expect.any(Function),
      { publicPath: "/porcupine_params.pv" },
      expect.any(Object)
    )
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("uses custom keyword public path when provided", async () => {
    const { deps, createWorker } = createDeps()
    const engine = await createPorcupineWakeEngine(
      {
        accessKey: "test-access-key",
        wakeWord: "hey luke",
        modelPath: "/porcupine_params.pv",
        keywordPath: "/keywords/hey-luke.ppn",
        sensitivity: 0.65,
      },
      deps
    )

    await engine.start()

    expect(createWorker).toHaveBeenCalledWith(
      "test-access-key",
      {
        publicPath: "/keywords/hey-luke.ppn",
        label: "hey luke",
        sensitivity: 0.65,
      },
      expect.any(Function),
      { publicPath: "/porcupine_params.pv" },
      expect.any(Object)
    )
  })

  it("throws when wake word is not built in and keyword path is missing", async () => {
    const { deps } = createDeps()

    await expect(
      createPorcupineWakeEngine(
        {
          accessKey: "test-access-key",
          wakeWord: "hey luke",
          modelPath: "/porcupine_params.pv",
        },
        deps
      )
    ).rejects.toThrow("OPENCLAW_WAKE_WORD_KEYWORD_PATH")
  })
})
