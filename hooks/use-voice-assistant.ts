import { useCallback, useEffect, useRef, useState } from "react"
import type { HalState } from "@/components/hal-eye"

interface Message {
  role: "user" | "assistant"
  content: string
}

interface UseVoiceAssistantReturn {
  state: HalState
  transcript: string
  response: string
  error: string
  toggleRecording: () => void
}

const CHAT_POLL_FALLBACK_DELAY_MS = 500
const SPEAKING_FALLBACK_TIMEOUT_MS = 4_000
const OPENCLAW_SESSION_STORAGE_KEY = "openclaw_session_id"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const parseChatSubmitResponse = (payload: unknown) => {
  if (!isObject(payload)) {
    throw new Error("Invalid chat submit response")
  }
  if (typeof payload.jobId !== "string" || !payload.jobId) {
    throw new Error("Chat response missing jobId")
  }
  if (typeof payload.pollAfterMs !== "number" || payload.pollAfterMs < 0) {
    throw new Error("Chat response missing pollAfterMs")
  }
  if (typeof payload.maxPollAttempts !== "number" || payload.maxPollAttempts <= 0) {
    throw new Error("Chat response missing maxPollAttempts")
  }
  if (typeof payload.maxWaitMs !== "number" || payload.maxWaitMs <= 0) {
    throw new Error("Chat response missing maxWaitMs")
  }
  if (typeof payload.sessionId !== "string" || !payload.sessionId.trim()) {
    throw new Error("Chat response missing sessionId")
  }

  return {
    jobId: payload.jobId,
    sessionId: payload.sessionId,
    pollAfterMs: payload.pollAfterMs,
    maxPollAttempts: payload.maxPollAttempts,
    maxWaitMs: payload.maxWaitMs,
  }
}

const parseJobResponse = (payload: unknown) => {
  if (!isObject(payload) || typeof payload.status !== "string") {
    throw new Error("Invalid job polling response")
  }

  const responseJobId =
    typeof payload.jobId === "string" && payload.jobId.length > 0
      ? payload.jobId
      : typeof payload.id === "string" && payload.id.length > 0
        ? payload.id
        : undefined

  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId.length > 0
      ? payload.sessionId
      : undefined

  return {
    jobId: responseJobId,
    sessionId,
    status: payload.status,
    pollAfterMs: typeof payload.pollAfterMs === "number" ? payload.pollAfterMs : CHAT_POLL_FALLBACK_DELAY_MS,
    progress: typeof payload.progress === "string" ? payload.progress : undefined,
    response:
      isObject(payload.response) &&
      typeof payload.response.text === "string" &&
      Array.isArray(payload.response.conversationHistory)
        ? {
            text: payload.response.text,
            conversationHistory: payload.response.conversationHistory as Message[],
          }
        : undefined,
    error:
      isObject(payload.error) &&
      typeof payload.error.message === "string" &&
      typeof payload.error.code === "string"
        ? {
            code: payload.error.code,
            message: payload.error.message,
          }
        : undefined,
    startedAt: typeof payload.startedAt === "string" ? payload.startedAt : undefined,
    finishedAt: typeof payload.finishedAt === "string" ? payload.finishedAt : undefined,
    attemptCount: typeof payload.attemptCount === "number" ? payload.attemptCount : undefined,
  }
}

const readApiErrorMessage = async (response: Response, fallbackMessage: string) => {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json()
      if (payload && typeof payload === "object") {
        if (typeof payload.error === "string") {
          return payload.error
        }
        if (typeof (payload as { message?: unknown }).message === "string") {
          return (payload as { message: string }).message
        }
        if (
          typeof (payload as { upstream?: unknown }).upstream === "object" &&
          (payload as { upstream: { message?: unknown } }).upstream?.message &&
          typeof (payload as { upstream: { message: unknown } }).upstream.message === "string"
        ) {
          return `${(payload as { upstream: { message: string } }).upstream.message} (${response.status})`
        }
      }
    } catch {
      // fall through
    }
  }

  try {
    const body = await response.text()
    if (body.trim()) {
      return `${body.trim()} (${response.status})`
    }
  } catch {
    // no-op
  }

  return `${fallbackMessage} (${response.status})`
}

const waitWithSignal = (delayMs: number, signal: AbortSignal) => {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(() => resolve(), delayMs)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })
}

export function useVoiceAssistant(): UseVoiceAssistantReturn {
  const [state, setState] = useState<HalState>("idle")
  const [transcript, setTranscript] = useState("")
  const [response, setResponse] = useState("")
  const [error, setError] = useState("")
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const conversationHistoryRef = useRef<Message[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakingTimeoutRef = useRef<number | null>(null)
  const pollControllerRef = useRef<AbortController | null>(null)

  const clearSpeakingTimeout = useCallback(() => {
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current)
      speakingTimeoutRef.current = null
    }
  }, [])

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const stopCurrentPolling = useCallback(() => {
    if (pollControllerRef.current) {
      pollControllerRef.current.abort()
      pollControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const storedSessionId = window.localStorage.getItem(OPENCLAW_SESSION_STORAGE_KEY)
    if (storedSessionId) {
      setSessionId(storedSessionId)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (sessionId) {
      window.localStorage.setItem(OPENCLAW_SESSION_STORAGE_KEY, sessionId)
    } else {
      window.localStorage.removeItem(OPENCLAW_SESSION_STORAGE_KEY)
    }
  }, [sessionId])

  const cancelCurrentJob = useCallback(async () => {
    if (!lastJobId) {
      return
    }

    try {
      await fetch(`/api/chat/jobs/${lastJobId}`, {
        method: "DELETE",
      })
    } catch {
      // best effort
    }
  }, [lastJobId])

  const pollJob = useCallback(async (opts: {
    jobId: string
    maxPollAttempts: number
    maxWaitMs: number
    initialPollAfterMs: number
  }) => {
    const abortController = new AbortController()
    pollControllerRef.current = abortController

    const startedAt = Date.now()
    let attempts = 0
    let nextPollDelayMs = Math.max(CHAT_POLL_FALLBACK_DELAY_MS, opts.initialPollAfterMs)

    try {
      while (attempts < opts.maxPollAttempts) {
        if (Date.now() - startedAt >= opts.maxWaitMs) {
          throw new Error("Chat request timed out while waiting for completion")
        }

        attempts += 1
        const pollResponse = await fetch(`/api/chat/jobs/${opts.jobId}`, {
          signal: abortController.signal,
        })
        if (!pollResponse.ok) {
          throw new Error(await readApiErrorMessage(pollResponse, "Chat job polling failed"))
        }

        const payload = await pollResponse.json()
        const pollState = parseJobResponse(payload)

        if (!pollState.jobId && !opts.jobId) {
          throw new Error("Invalid job response")
        }
        if (pollState.jobId && pollState.jobId !== opts.jobId) {
          throw new Error("Job response mismatch")
        }

        if (pollState.status === "completed") {
          if (!pollState.response?.text || !Array.isArray(pollState.response?.conversationHistory)) {
            throw new Error("Invalid completed job payload")
          }
          return {
            text: pollState.response.text,
            conversationHistory: pollState.response.conversationHistory,
            sessionId: pollState.sessionId,
          }
        }

        if (pollState.status === "failed" || pollState.status === "cancelled") {
          throw new Error(pollState.error?.message || "Chat job failed")
        }

        nextPollDelayMs = Math.max(
          CHAT_POLL_FALLBACK_DELAY_MS,
          Number.isFinite(pollState.pollAfterMs) ? pollState.pollAfterMs : CHAT_POLL_FALLBACK_DELAY_MS
        )
        await waitWithSignal(nextPollDelayMs, abortController.signal)
      }

      throw new Error("Maximum chat polling attempts exceeded")
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Chat polling cancelled")
      }
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error("Chat polling timed out while waiting for completion")
      }
      throw error instanceof Error ? error : new Error("Unknown polling error")
    } finally {
      if (pollControllerRef.current === abortController) {
        pollControllerRef.current = null
      }
    }
  }, [])

  const processAudio = useCallback(
    async (audioBlob: Blob) => {
      stopMediaStream()
      setState("processing")
      setError("")
      setResponse("")

      try {
        const sttForm = new FormData()
        sttForm.append("audio", audioBlob, "recording.webm")

        const sttResponse = await fetch("/api/stt", {
          method: "POST",
          body: sttForm,
        })

        if (!sttResponse.ok) {
          const sttError = await sttResponse.json()
          throw new Error(sttError.error || "Speech-to-text failed")
        }

        const { text: userText } = await sttResponse.json()
        if (!userText || !userText.trim().length) {
          throw new Error("Could not understand the audio. Please try again.")
        }

        setTranscript(userText)

        const chatResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userText,
            ...(sessionId ? { sessionId } : {}),
            conversationHistory: conversationHistoryRef.current,
          }),
        })

        if (!chatResponse.ok) {
          const chatErrorMessage = await readApiErrorMessage(chatResponse, "Chat completion failed")
          throw new Error(chatErrorMessage)
        }

        const chatPayload = parseChatSubmitResponse(await chatResponse.json())
        setSessionId(chatPayload.sessionId)
        setLastJobId(chatPayload.jobId)
        setState("waiting_for_response")

        const completed = await pollJob({
          jobId: chatPayload.jobId,
          maxPollAttempts: chatPayload.maxPollAttempts,
          maxWaitMs: chatPayload.maxWaitMs,
          initialPollAfterMs: chatPayload.pollAfterMs,
        })

        setSessionId(completed.sessionId || chatPayload.sessionId)
        conversationHistoryRef.current = completed.conversationHistory
        setResponse(completed.text)
        setState("speaking")

        const ttsResponse = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: completed.text }),
        })

        if (!ttsResponse.ok) {
          console.error("TTS failed, response text is shown instead")
          setState("idle")
          return
        }

        const audioBuffer = await ttsResponse.arrayBuffer()
        const audioBlob2 = new Blob([audioBuffer], { type: "audio/mpeg" })
        const audioUrl = URL.createObjectURL(audioBlob2)

        if (audioRef.current) {
          audioRef.current.pause()
          URL.revokeObjectURL(audioRef.current.src)
        }

        const audio = new Audio(audioUrl)
        audioRef.current = audio

        const completeSpeech = () => {
          if (audioRef.current !== audio) {
            return
          }
          clearSpeakingTimeout()
          setState("idle")
          URL.revokeObjectURL(audioUrl)
          audioRef.current = null
        }

        audio.onended = completeSpeech
        audio.onerror = completeSpeech

        speakingTimeoutRef.current = window.setTimeout(() => {
          completeSpeech()
        }, SPEAKING_FALLBACK_TIMEOUT_MS)

        const playResult = audio.play()
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch((error) => {
            console.error("TTS playback failed, continuing without completion callback:", error)
          })
        }
      } catch (error) {
        console.error("Voice assistant error:", error)
        if (error instanceof Error && error.message === "Chat polling cancelled") {
          setError("")
        } else {
          setError(error instanceof Error ? error.message : "An unexpected error occurred")
        }
        setState("idle")
      } finally {
        setLastJobId(null)
        stopCurrentPolling()
      }
    },
    [pollJob, stopCurrentPolling, stopMediaStream, sessionId]
  )

  const startRecording = useCallback(async () => {
    try {
      setError("")
      setTranscript("")
      setResponse("")

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      })

      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" })
        processAudio(audioBlob)
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setState("recording")
    } catch (error) {
      console.error("Failed to start recording:", error)
      setError("Microphone access denied. Please allow microphone access and try again.")
      setState("idle")
    }
  }, [processAudio])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const stopPlayback = useCallback(() => {
    clearSpeakingTimeout()
    if (audioRef.current) {
      audioRef.current.pause()
      if (audioRef.current.src) {
        URL.revokeObjectURL(audioRef.current.src)
      }
      audioRef.current = null
    }
  }, [])

  const abortAndReset = useCallback(async () => {
    stopCurrentPolling()
    await cancelCurrentJob()
    stopPlayback()
    setState("idle")
    setResponse("")
    setError("")
  }, [cancelCurrentJob, stopCurrentPolling, stopPlayback])

  const toggleRecording = useCallback(() => {
    if (state === "idle") {
      startRecording()
      return
    }

    if (state === "recording") {
      stopRecording()
      return
    }

    if (state === "waiting_for_response") {
      void abortAndReset()
      return
    }

    // processing and speaking are handled internally
  }, [abortAndReset, startRecording, state, stopRecording])

  useEffect(() => {
    return () => {
      stopCurrentPolling()
      stopMediaStream()
      stopPlayback()
      if (audioRef.current) {
        URL.revokeObjectURL(audioRef.current.src)
      }
    }
  }, [stopCurrentPolling, stopMediaStream, stopPlayback])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (sessionId) {
      window.localStorage.setItem(OPENCLAW_SESSION_STORAGE_KEY, sessionId)
    } else {
      window.localStorage.removeItem(OPENCLAW_SESSION_STORAGE_KEY)
    }
  }, [sessionId])

  return {
    state,
    transcript,
    response,
    error,
    toggleRecording,
  }
}
