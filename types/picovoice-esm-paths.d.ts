declare module "@picovoice/porcupine-web/dist/esm/index.js" {
  export const PorcupineWorker: {
    create: (
      accessKey: string,
      keywords: string | { publicPath: string; label: string; sensitivity?: number },
      keywordDetectionCallback: (detection: { label: string; index: number }) => void,
      model: { publicPath: string },
      options?: { processErrorCallback?: (error: unknown) => void }
    ) => Promise<{ release: () => Promise<void>; terminate: () => void }>
  }

  export const BuiltInKeyword: Record<string, string>
}

declare module "@picovoice/web-voice-processor/dist/esm/index.js" {
  export const WebVoiceProcessor: {
    subscribe: (engine: unknown) => Promise<void>
    unsubscribe: (engine: unknown) => Promise<void>
  }
}
