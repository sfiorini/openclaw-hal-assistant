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
  speaking: "SPEAKING",
}

const stateDescriptions: Record<HalState, string> = {
  idle: "Press the eye to speak",
  recording: "Listening... Press again to stop",
  processing: "Analyzing your request...",
  speaking: "HAL is responding...",
}

export function HalStatus({ state, transcript, response, error }: HalStatusProps) {
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-lg px-4">
      {/* Status indicator */}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-2 h-2 rounded-full transition-colors duration-300",
            state === "idle" && "bg-hal-red opacity-60",
            state === "recording" && "bg-[hsl(0,100%,60%)] animate-pulse",
            state === "processing" && "bg-[hsl(40,100%,50%)] animate-pulse",
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
        <div className="w-full rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="font-mono text-xs text-destructive text-center">{error}</p>
        </div>
      )}

      {/* Transcript */}
      {transcript && (
        <div className="w-full rounded-md border border-border bg-card px-4 py-3">
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            You said:
          </p>
          <p className="font-mono text-sm text-foreground leading-relaxed">
            {transcript}
          </p>
        </div>
      )}

      {/* Response */}
      {response && (
        <div className="w-full rounded-md border border-hal-red/20 bg-hal-red/5 px-4 py-3">
          <p className="font-mono text-[10px] text-hal-red/70 uppercase tracking-wider mb-1">
            HAL 9000:
          </p>
          <p className="font-mono text-sm text-foreground leading-relaxed">
            {response}
          </p>
        </div>
      )}
    </div>
  )
}
