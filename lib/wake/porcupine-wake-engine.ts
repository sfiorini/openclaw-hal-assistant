type PorcupineKeywordConfig =
  | string
  | {
      publicPath: string
      label: string
      sensitivity?: number
    }

type PorcupineWorkerLike = {
  release: () => Promise<void>
  terminate: () => void
}

type PorcupineModule = {
  PorcupineWorker: {
    create: (
      accessKey: string,
      keywords: PorcupineKeywordConfig,
      keywordDetectionCallback: (detection: { label: string; index: number }) => void,
      model: { publicPath: string },
      options?: { processErrorCallback?: (error: unknown) => void }
    ) => Promise<PorcupineWorkerLike>
  }
  BuiltInKeyword: Record<string, string>
}

type WebVoiceProcessorModule = {
  WebVoiceProcessor: {
    subscribe: (engine: unknown) => Promise<void>
    unsubscribe: (engine: unknown) => Promise<void>
  }
}

type PorcupineWakeEngineDeps = {
  loadPorcupine: () => Promise<PorcupineModule>
  loadWebVoiceProcessor: () => Promise<WebVoiceProcessorModule>
}

export type CreatePorcupineWakeEngineInput = {
  accessKey: string
  wakeWord: string
  modelPath: string
  keywordPath?: string
  sensitivity?: number
  onWakeWordDetected?: () => void
  onError?: (message: string) => void
}

export type PorcupineWakeEngine = {
  start: () => Promise<void>
  stop: () => Promise<void>
  release: () => Promise<void>
  isRunning: () => boolean
}

const normalizeWakeWord = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")

const DEFAULT_SENSITIVITY = 0.6

const defaultDeps: PorcupineWakeEngineDeps = {
  loadPorcupine: async () => import("@picovoice/porcupine-web/dist/esm/index.js"),
  loadWebVoiceProcessor: async () =>
    import("@picovoice/web-voice-processor/dist/esm/index.js"),
}

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error
  }
  return "unknown error"
}

const resolveBuiltInKeyword = (wakeWord: string, builtInKeyword: Record<string, string>) => {
  const normalizedWakeWord = normalizeWakeWord(wakeWord)

  for (const value of Object.values(builtInKeyword)) {
    if (normalizeWakeWord(value) === normalizedWakeWord) {
      return value
    }
  }

  return null
}

export async function createPorcupineWakeEngine(
  input: CreatePorcupineWakeEngineInput,
  deps: PorcupineWakeEngineDeps = defaultDeps
): Promise<PorcupineWakeEngine> {
  const accessKey = input.accessKey.trim()
  const wakeWord = input.wakeWord.trim()
  const modelPath = input.modelPath.trim()

  if (!accessKey) {
    throw new Error("OPENCLAW_WAKE_WORD_ACCESS_KEY is required")
  }

  if (!modelPath) {
    throw new Error("OPENCLAW_WAKE_WORD_MODEL_PATH is required")
  }

  const { PorcupineWorker, BuiltInKeyword } = await deps.loadPorcupine()
  const { WebVoiceProcessor } = await deps.loadWebVoiceProcessor()

  const sensitivity = typeof input.sensitivity === "number" ? input.sensitivity : DEFAULT_SENSITIVITY

  const keywordConfig: PorcupineKeywordConfig = input.keywordPath?.trim()
    ? {
        publicPath: input.keywordPath.trim(),
        label: wakeWord,
        sensitivity,
      }
    : (() => {
        const builtIn = resolveBuiltInKeyword(wakeWord, BuiltInKeyword)
        if (builtIn) {
          return builtIn
        }
        throw new Error(
          `Wake word "${wakeWord}" is not a Porcupine built-in keyword. Set OPENCLAW_WAKE_WORD_KEYWORD_PATH to a .ppn model.`
        )
      })()

  const worker = await PorcupineWorker.create(
    accessKey,
    keywordConfig,
    () => {
      input.onWakeWordDetected?.()
    },
    { publicPath: modelPath },
    {
      processErrorCallback: (error) => {
        input.onError?.(`Porcupine wake engine error: ${toErrorMessage(error)}`)
      },
    }
  )

  let running = false

  return {
    start: async () => {
      if (running) {
        return
      }
      await WebVoiceProcessor.subscribe(worker)
      running = true
    },
    stop: async () => {
      if (!running) {
        return
      }
      await WebVoiceProcessor.unsubscribe(worker)
      running = false
    },
    release: async () => {
      if (running) {
        await WebVoiceProcessor.unsubscribe(worker)
        running = false
      }
      await worker.release()
      worker.terminate()
    },
    isRunning: () => running,
  }
}
