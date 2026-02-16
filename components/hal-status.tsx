"use client"

import type { HalState } from "./hal-eye"
import { cn } from "@/lib/utils"

interface HalStatusProps {
  state: HalState
  transcript?: string
  response?: string
  error?: string
  wakeWordEnabled?: boolean
  wakeWordSupported?: boolean
  textTranslationsEnabled?: boolean
  showTranslations?: boolean
  onToggleTranslations?: () => void
}

const stateLabels: Record<HalState, string> = {
  idle: "READY",
  recording: "RECORDING",
  processing: "PROCESSING",
  waiting_for_response: "WAITING",
  speaking: "SPEAKING",
}

const stateDescriptions: Record<HalState, string> = {
  idle: "Press the eye to speak",
  recording: "Listening... Press again to stop",
  processing: "Analyzing your request...",
  waiting_for_response: "Processing request. Waiting for result...",
  speaking: "HAL is responding...",
}

export function HalStatus({
  state,
  transcript,
  response,
  error,
  wakeWordEnabled,
  wakeWordSupported,
  textTranslationsEnabled,
  showTranslations,
  onToggleTranslations,
}: HalStatusProps) {
  const isTranslationsEnabled = textTranslationsEnabled !== false
  const isTranslationsVisible = showTranslations !== false

  const fallbackMessage =
    wakeWordEnabled === false
      ? "Wake word disabled; manual mode is active."
      : wakeWordEnabled && wakeWordSupported === false
        ? "Wake word unavailable; manual mode is active."
        : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-stretch gap-5 px-2 sm:px-4">
      {/* Status indicator */}
      <div className="flex shrink-0 items-center justify-center gap-3">
        <div
          className={cn(
            "w-2 h-2 rounded-full transition-colors duration-300",
            state === "idle" && "bg-hal-red opacity-60",
            state === "recording" && "bg-[hsl(0,100%,60%)] animate-pulse",
            state === "processing" && "bg-[hsl(40,100%,50%)] animate-pulse",
            state === "waiting_for_response" && "bg-[hsl(0,100%,70%)] animate-pulse",
            state === "speaking" && "bg-[hsl(0,85%,50%)] animate-pulse",
          )}
        />
        <span className="font-mono text-sm tracking-[0.3em] text-muted-foreground uppercase">
          {stateLabels[state]}
        </span>
      </div>

      {/* Description */}
      <p className="shrink-0 font-mono text-xs text-muted-foreground tracking-wider text-center">
        {stateDescriptions[state]}
      </p>

      {fallbackMessage && (
        <p className="shrink-0 rounded-md border border-dashed border-muted px-3 py-2 text-[10px] text-muted-foreground/70 tracking-wide text-center">
          {fallbackMessage}
        </p>
      )}

      {isTranslationsEnabled && (
        <div className="shrink-0 flex items-center justify-center">
          <button
            type="button"
            onClick={onToggleTranslations}
            aria-pressed={isTranslationsVisible}
            className="font-mono text-[10px] tracking-[0.2em] uppercase rounded-md border border-border/80 bg-card/60 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-hal-red/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hal-red/50"
          >
            {isTranslationsVisible ? "Hide Text" : "Show Text"}
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="shrink-0 w-full rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 sm:px-4 sm:py-3">
          <p className="font-mono text-xs text-destructive text-center">{error}</p>
        </div>
      )}

      {/* Transcript */}
      {isTranslationsEnabled && isTranslationsVisible && (transcript || response) && (
        <div
          className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2"
          style={{ gridAutoRows: "minmax(0, 1fr)" }}
        >
          {transcript && (
            <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card px-3 py-2 sm:px-4 sm:py-3">
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                You said:
              </p>
              <div className="mt-1 min-h-0 flex-1 h-full overflow-y-auto overflow-x-hidden scrollbar-themed">
                <p className="font-mono text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {transcript}
                </p>
              </div>
            </div>
          )}

          {response && (
            <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-hal-red/20 bg-hal-red/5 px-3 py-2 sm:px-4 sm:py-3">
              <p className="font-mono text-[10px] text-hal-red/70 uppercase tracking-wider">
                HAL 9000:
              </p>
              <div className="mt-1 min-h-0 flex-1 h-full overflow-y-auto overflow-x-hidden scrollbar-themed">
                <p className="font-mono text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {response}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
