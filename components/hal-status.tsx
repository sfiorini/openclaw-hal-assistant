"use client"

import type { HalState } from "./hal-eye"
import { cn } from "@/lib/utils"

interface HalStatusProps {
  state: HalState
  transcript?: string
  response?: string
  error?: string
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

export function HalStatus({ state, transcript, response, error }: HalStatusProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col items-stretch gap-5 px-2 sm:px-4 overflow-hidden">
      {/* Status indicator */}
      <div className="flex items-center justify-center gap-3">
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
      <p className="font-mono text-xs text-muted-foreground tracking-wider text-center">
        {stateDescriptions[state]}
      </p>

      {/* Error message */}
      {error && (
        <div className="w-full rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 sm:px-4 sm:py-3">
          <p className="font-mono text-xs text-destructive text-center">{error}</p>
        </div>
      )}

      {/* Transcript */}
      {(transcript || response) && (
        <div
          className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 overflow-hidden"
          style={{ gridAutoRows: "minmax(0, 1fr)" }}
        >
          {transcript && (
            <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card px-3 py-2 sm:px-4 sm:py-3">
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                You said:
              </p>
              <div className="mt-1 min-h-0 flex-1 h-full overflow-y-auto overflow-x-hidden">
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
              <div className="mt-1 min-h-0 flex-1 h-full overflow-y-auto overflow-x-hidden">
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
