"use client"

import { HalEye } from "./hal-eye"
import { HalStatus } from "./hal-status"
import { useVoiceAssistant } from "@/hooks/use-voice-assistant"

export function HalPanel() {
  const { state, transcript, response, error, toggleRecording } =
    useVoiceAssistant()

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center bg-background overflow-hidden">
      {/* Subtle radial vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, hsl(0 0% 0% / 0.6) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Top label */}
      <div className="absolute top-8 flex flex-col items-center gap-2">
        <h1 className="font-mono text-xs tracking-[0.5em] text-muted-foreground uppercase">
          HAL 9000
        </h1>
        <div className="h-px w-16 bg-border" />
        <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/60 uppercase">
          OpenClaw Voice Interface
        </p>
      </div>

      {/* Central eye */}
      <div className="relative z-10 flex flex-col items-center gap-10">
        <HalEye
          state={state}
          onClick={toggleRecording}
          disabled={state === "processing" || state === "speaking"}
        />
        <HalStatus
          state={state}
          transcript={transcript}
          response={response}
          error={error}
        />
      </div>

      {/* Bottom system info */}
      <div className="absolute bottom-8 flex flex-col items-center gap-1">
        <p className="font-mono text-[9px] tracking-[0.3em] text-muted-foreground/40 uppercase">
          Voice-Activated Conversational Interface
        </p>
        <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground/25 uppercase">
          System Operational
        </p>
      </div>
    </main>
  )
}
