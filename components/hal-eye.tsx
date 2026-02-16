"use client"

import { cn } from "@/lib/utils"

export type HalState = "idle" | "recording" | "processing" | "waiting_for_response" | "speaking"

interface HalEyeProps {
  state: HalState
  onClick: () => void
  disabled?: boolean
}

export function HalEye({ state, onClick, disabled = false }: HalEyeProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={
        state === "recording"
          ? "Stop recording"
          : state === "idle"
            ? "Start recording"
            : "Processing"
      }
      className={cn(
        "relative flex items-center justify-center",
        "w-36 h-36 md:w-48 md:h-48 lg:w-56 lg:h-56",
        "rounded-full cursor-pointer transition-all duration-300",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hal-red focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {/* Outer metallic ring */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-hal-panel-light via-hal-panel to-background border border-hal-panel-light" />

      {/* Inner dark bezel */}
      <div className="absolute inset-3 md:inset-4 rounded-full bg-gradient-to-br from-[hsl(0,0%,6%)] to-[hsl(0,0%,2%)] border border-[hsl(0,0%,15%)]" />

      {/* The glowing red eye lens */}
      <div
        className={cn(
          "absolute inset-6 md:inset-8 lg:inset-10 rounded-full transition-all duration-500",
          "bg-gradient-radial",
          state === "idle" && "animate-hal-pulse",
          state === "recording" && "animate-hal-recording",
          state === "processing" && "animate-hal-pulse",
          state === "waiting_for_response" && "animate-hal-pulse",
          state === "speaking" && "animate-hal-speaking",
        )}
        style={{
          background:
            state === "recording"
              ? "radial-gradient(circle at 40% 35%, hsl(0 100% 85%), hsl(0 90% 55%) 40%, hsl(0 85% 35%) 70%, hsl(0 80% 20%))"
              : state === "speaking"
                ? "radial-gradient(circle at 40% 35%, hsl(0 100% 80%), hsl(0 85% 50%) 40%, hsl(0 80% 30%) 70%, hsl(0 75% 18%))"
                : "radial-gradient(circle at 40% 35%, hsl(0 100% 75%), hsl(0 85% 45%) 40%, hsl(0 80% 28%) 70%, hsl(0 70% 15%))",
        }}
      >
        {/* Inner highlight / lens flare */}
        <div className="absolute top-[20%] left-[25%] w-[20%] h-[15%] rounded-full bg-[hsl(0,100%,90%)] opacity-60 blur-[2px]" />
        <div className="absolute top-[30%] left-[30%] w-[8%] h-[8%] rounded-full bg-[hsl(0,0%,100%)] opacity-80 blur-[1px]" />
      </div>

      {/* Processing spinner overlay */}
      {(state === "processing" || state === "waiting_for_response") && (
        <div className="absolute inset-6 md:inset-8 lg:inset-10 rounded-full">
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[hsl(0,100%,70%)] animate-spin" />
        </div>
      )}
    </button>
  )
}
