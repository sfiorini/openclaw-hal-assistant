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
  wakeWordEnabled: boolean
  wakeWordSupported: boolean
}

interface UseVoiceAssistantOptions {
  wakeWordEnabled?: boolean
  wakeWord?: string
}

const SPEAKING_FALLBACK_TIMEOUT_MS = 4_000
const RECORDING_MAX_DURATION_MS = 12_000
const RECORDING_MIN_DURATION_MS = 800
const RECORDING_SILENCE_WINDOW_MS = 2_400
const RECORDING_VOICE_ACTIVITY_THRESHOLD = 0.012
const OPENCLAW_SESSION_STORAGE_KEY = "openclaw_session_id"

type WakeWordResult = {
  isFinal?: boolean
  0?: {
    transcript?: unknown
  }
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<WakeWordResult> }) => void) | null
  onerror: ((event: { error?: unknown }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionLikeCtor = new () => SpeechRecognitionLike

const resolveSpeechRecognitionCtor = (): SpeechRecognitionLikeCtor | null => {
  if (typeof window === "undefined") {
    return null
  }

  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionLikeCtor
    webkitSpeechRecognition?: SpeechRecognitionLikeCtor
  }

  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

interface ChatSubmitResponse {
  text: string
  sessionId: string
  conversationHistory: Message[]
}

const parseChatSubmitResponse = (payload: unknown): ChatSubmitResponse => {
  if (!isObject(payload)) {
    throw new Error("Invalid chat submit response")
  }

  if (typeof payload.text !== "string" || !payload.text.trim()) {
    throw new Error("Chat response missing text")
  }

  if (!Array.isArray(payload.conversationHistory)) {
    throw new Error("Chat response missing conversationHistory")
  }

  if (typeof payload.sessionId !== "string" || !payload.sessionId.trim()) {
    throw new Error("Chat response missing sessionId")
  }

  const conversationHistory = payload.conversationHistory.filter(
    (item): item is Message =>
      !!item &&
      typeof item === "object" &&
      ((item as Message).role === "user" || (item as Message).role === "assistant") &&
      typeof (item as Message).content === "string"
  )

  if (conversationHistory.length !== payload.conversationHistory.length) {
    throw new Error("Chat response has invalid conversation history entries")
  }

  return {
    text: payload.text,
    conversationHistory,
    sessionId: payload.sessionId,
  }
}

const normalizeResultTranscript = (result: unknown) => {
  if (!result || typeof result !== "object") {
    return null
  }

  const candidate = result as {
    0?: {
      transcript?: unknown
    }
  }

  const transcript = candidate[0]?.transcript
  return typeof transcript === "string" ? transcript.trim() : null
}

const computeRms = (samples: Float32Array) => {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i]
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

const unlockBrowserAudio = () => {
  if (typeof window === "undefined") {
    return
  }

  const AudioCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioCtor) {
    return
  }

  try {
    const audioContext = new AudioCtor()
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined)
    }
    void audioContext.close().catch(() => undefined)
  } catch {
    // best effort
  }
}

const extractWakeText = (results: ArrayLike<WakeWordResult> | undefined, wakeWord: string) => {
  if (!results || typeof results.length !== "number") {
    return null
  }

  const wake = wakeWord.trim().toLowerCase()
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (!result) {
      continue
    }

    const transcript = normalizeResultTranscript(result)
    if (!transcript) {
      continue
    }

    const normalized = transcript.toLowerCase()
    if (normalized.includes(wake)) {
      return normalized
    }
  }

  return null
}

const readApiErrorMessage = async (response: Response, fallbackMessage: string) => {
  const statusSuffix = `(${response.status} ${response.statusText || "Error"})`

  try {
    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const payload = await response.json()
      if (payload && typeof payload === "object") {
        if (typeof payload.error === "string") {
          return `${payload.error} ${statusSuffix}`
        }
        if (typeof (payload as { message?: unknown }).message === "string") {
          return `${(payload as { message: string }).message} ${statusSuffix}`
        }
        if (Array.isArray((payload as { details?: unknown }).details)) {
          const details = (payload as { details: Array<{ path?: unknown; message?: unknown }> }).details
          const text = details
            .map((detail) => {
              const path = typeof detail?.path === "string" ? detail.path : undefined
              const message = typeof detail?.message === "string" ? detail.message : undefined
              if (!path && !message) {
                return ""
              }
              return `${path || "error"}: ${message || "invalid value"}`
            })
            .filter(Boolean)
            .join("; ")

          if (text) {
            return `Invalid request: ${text} ${statusSuffix}`
          }
        }
        if (
          typeof (payload as { upstream?: unknown }).upstream === "object" &&
          (payload as { upstream: { message?: unknown } }).upstream?.message &&
          typeof (payload as { upstream: { message: unknown } }).upstream.message === "string"
        ) {
          return `${(payload as { upstream: { message: string } }).upstream.message} ${statusSuffix}`
        }
      }
    }
  } catch {
    // fall through to text body parsing
  }

  try {
    const body = await response.text()
    if (body.trim()) {
      return `${body.trim()} ${statusSuffix}`
    }
  } catch {
    // no-op
  }

  return `${fallbackMessage} ${statusSuffix}`
}

const CHAT_HISTORY_PAYLOAD_LIMIT = 20

export function useVoiceAssistant(
  options: UseVoiceAssistantOptions = {}
): UseVoiceAssistantReturn {
  const [state, setState] = useState<HalState>("idle")
  const [transcript, setTranscript] = useState("")
  const [response, setResponse] = useState("")
  const [error, setError] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [wakeWordSupported, setWakeWordSupported] = useState(false)

  const wakeWord = options.wakeWord?.trim() || "hey luke"
  const wakeWordEnabled = options.wakeWordEnabled ?? true

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordingTimeoutRef = useRef<number | null>(null)
  const recordingSilenceRafRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastVoiceActivityMsRef = useRef<number>(0)
  const recordingStartedAtMsRef = useRef<number>(0)
  const conversationHistoryRef = useRef<Message[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakingTimeoutRef = useRef<number | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const wakeRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const wakeRecognitionActiveRef = useRef(false)
  const hasUserGestureRef = useRef(false)
  const wakeSuppressedRef = useRef(false)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
    wakeSuppressedRef.current = state !== "idle"
  }, [state])

  useEffect(() => {
    setWakeWordSupported(Boolean(resolveSpeechRecognitionCtor()))
  }, [wakeWordEnabled, wakeWord])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const markGesture = () => {
      hasUserGestureRef.current = true
      unlockBrowserAudio()
    }

    const onceOptions: AddEventListenerOptions = { passive: true, once: true }
    window.addEventListener("pointerdown", markGesture, onceOptions)
    window.addEventListener("keydown", markGesture, onceOptions)
    window.addEventListener("touchstart", markGesture, onceOptions)

    return () => {
      window.removeEventListener("pointerdown", markGesture)
      window.removeEventListener("keydown", markGesture)
      window.removeEventListener("touchstart", markGesture)
    }
  }, [])

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

  const clearRecordingWatchdog = useCallback(() => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }

    if (recordingSilenceRafRef.current) {
      cancelAnimationFrame(recordingSilenceRafRef.current)
      recordingSilenceRafRef.current = null
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
  }, [])

  const stopCurrentRequest = useCallback(() => {
    if (requestControllerRef.current) {
      requestControllerRef.current.abort()
      requestControllerRef.current = null
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

  const stopPlayback = useCallback(() => {
    clearSpeakingTimeout()
    if (audioRef.current) {
      audioRef.current.pause()
      if (audioRef.current.src) {
        URL.revokeObjectURL(audioRef.current.src)
      }
      audioRef.current = null
    }
  }, [clearSpeakingTimeout])

  const stopWakeRecognition = useCallback(() => {
    const recognition = wakeRecognitionRef.current
    if (!recognition) {
      return
    }

    if (!wakeRecognitionActiveRef.current) {
      return
    }

    try {
      wakeRecognitionActiveRef.current = false
      recognition.stop()
    } catch {
      // best effort
    }
  }, [])

  const processAudio = useCallback(
    async (audioBlob: Blob) => {
      stopMediaStream()
      wakeSuppressedRef.current = true
      setState("processing")
      setError("")
      setResponse("")

      const requestController = new AbortController()
      requestControllerRef.current = requestController

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
        const normalizedUserText = typeof userText === "string" ? userText.trim() : ""
        if (!normalizedUserText.length) {
          throw new Error("Could not understand the audio. Please try again.")
        }

        setTranscript(normalizedUserText)

        const chatResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: normalizedUserText,
            ...(sessionId ? { sessionId } : {}),
            conversationHistory: conversationHistoryRef.current
              .filter((item) => item.content.trim().length > 0)
              .slice(-CHAT_HISTORY_PAYLOAD_LIMIT),
          }),
          signal: requestController.signal,
        })

        if (!chatResponse.ok) {
          const chatErrorMessage = await readApiErrorMessage(chatResponse, "Chat completion failed")
          throw new Error(chatErrorMessage)
        }

        const payload = (await chatResponse.json()) as unknown
        const chatPayload = parseChatSubmitResponse(payload)

        setSessionId(chatPayload.sessionId)
        conversationHistoryRef.current = chatPayload.conversationHistory.filter(
          (item) => item.content.trim().length > 0
        )
        setState("waiting_for_response")
        setResponse(chatPayload.text)
        setState("speaking")

        const ttsResponse = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chatPayload.text }),
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
          playResult.catch((playError) => {
            const isAutoplayBlock =
              (playError instanceof DOMException && playError.name === "NotAllowedError") ||
              (playError instanceof Error && /interact with the document first/i.test(playError.message))

            if (isAutoplayBlock) {
              completeSpeech()
              return
            }

            console.error("TTS playback failed, continuing without completion callback:", playError)
          })
        }
      } catch (requestError) {
        console.error("Voice assistant error:", requestError)
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          setError("")
        } else {
          setError(requestError instanceof Error ? requestError.message : "An unexpected error occurred")
        }
        setState("idle")
      } finally {
        requestControllerRef.current = null
      }
    },
    [sessionId, stopMediaStream, stopWakeRecognition, clearSpeakingTimeout]
  )

  const stopRecording = useCallback(() => {
    clearRecordingWatchdog()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
  }, [clearRecordingWatchdog])

  const startRecordingWatchdog = useCallback(() => {
    if (typeof window === "undefined" || !streamRef.current) {
      return
    }

    recordingStartedAtMsRef.current = Date.now()
    lastVoiceActivityMsRef.current = recordingStartedAtMsRef.current

    recordingTimeoutRef.current = window.setTimeout(() => {
      if (stateRef.current === "recording") {
        stopRecording()
      }
    }, RECORDING_MAX_DURATION_MS)

    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) {
      return
    }

    try {
      const audioContext = new AudioCtor()
      const source = audioContext.createMediaStreamSource(streamRef.current)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      audioContextRef.current = audioContext

      const samples = new Float32Array(analyser.fftSize)

      const tick = () => {
        if (stateRef.current !== "recording") {
          return
        }

        analyser.getFloatTimeDomainData(samples)
        const rms = computeRms(samples)
        if (rms >= RECORDING_VOICE_ACTIVITY_THRESHOLD) {
          lastVoiceActivityMsRef.current = Date.now()
        }

        const now = Date.now()
        const elapsed = now - recordingStartedAtMsRef.current
        const silenceMs = now - lastVoiceActivityMsRef.current

        if (elapsed >= RECORDING_MIN_DURATION_MS && silenceMs >= RECORDING_SILENCE_WINDOW_MS) {
          stopRecording()
          return
        }

        recordingSilenceRafRef.current = window.requestAnimationFrame(tick)
      }

      recordingSilenceRafRef.current = window.requestAnimationFrame(tick)
    } catch {
      // Keep max-duration watchdog even if audio analysis is unavailable.
    }
  }, [stopRecording])

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
      stateRef.current = "recording"
      setState("recording")
      startRecordingWatchdog()
    } catch (recordError) {
      console.error("Failed to start recording:", recordError)
      setError("Microphone access denied. Please allow microphone access and try again.")
      setState("idle")
    }
  }, [processAudio, startRecordingWatchdog])

  const abortAndReset = useCallback(() => {
    stopCurrentRequest()
    stopPlayback()
    setState("idle")
    setResponse("")
    setError("")
  }, [stopCurrentRequest, stopPlayback])

  const startWakeRecognition = useCallback(() => {
    const constructor = resolveSpeechRecognitionCtor()
    if (!constructor || !wakeWordEnabled || !wakeWord.trim()) {
      return
    }

    if (!hasUserGestureRef.current) {
      return
    }

    if (stateRef.current !== "idle") {
      return
    }

    if (wakeRecognitionActiveRef.current) {
      return
    }

    const recognition = wakeRecognitionRef.current ?? new constructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onresult = (event: { results: ArrayLike<WakeWordResult> }) => {
      if (wakeSuppressedRef.current) {
        return
      }

      const detected = extractWakeText(event.results, wakeWord)
      if (!detected) {
        return
      }

      wakeSuppressedRef.current = true

      if (stateRef.current !== "idle") {
        return
      }

      stateRef.current = "recording"
      stopWakeRecognition()
      void startRecording()
    }

    recognition.onerror = (event: { error?: unknown }) => {
      wakeRecognitionActiveRef.current = false
      const errorCode = typeof event?.error === "string" ? event.error : "unknown"
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
        return
      }
      if (wakeWordEnabled && stateRef.current === "idle" && !wakeRecognitionActiveRef.current) {
        startWakeRecognition()
      }
    }

    recognition.onend = () => {
      wakeRecognitionActiveRef.current = false
      if (wakeWordEnabled && stateRef.current === "idle" && !wakeRecognitionActiveRef.current) {
        startWakeRecognition()
      }
    }

    wakeRecognitionRef.current = recognition

    try {
      wakeRecognitionActiveRef.current = true
      recognition.start()
    } catch {
      wakeRecognitionActiveRef.current = false
    }
  }, [startRecording, stopWakeRecognition, wakeWord, wakeWordEnabled])

  useEffect(() => {
    if (!wakeWordEnabled || !wakeWord.trim()) {
      stopWakeRecognition()
      setWakeWordSupported(false)
      return
    }

    const ctor = resolveSpeechRecognitionCtor()
    if (!ctor) {
      stopWakeRecognition()
      setWakeWordSupported(false)
      return
    }

    setWakeWordSupported(true)

    if (state === "idle") {
      if (!wakeRecognitionActiveRef.current) {
        startWakeRecognition()
      }
      return
    }

    stopWakeRecognition()
  }, [state, wakeWordEnabled, wakeWord, startWakeRecognition, stopWakeRecognition])

  const toggleRecording = useCallback(() => {
    if (state === "idle") {
      hasUserGestureRef.current = true
      unlockBrowserAudio()
      startRecording()
      return
    }

    if (state === "recording") {
      stopRecording()
      return
    }

    if (state === "waiting_for_response") {
      abortAndReset()
      return
    }

    if (state === "speaking") {
      hasUserGestureRef.current = true
      unlockBrowserAudio()
      stopPlayback()
      startRecording()
      return
    }

    // processing currently internal only
  }, [abortAndReset, startRecording, state, stopPlayback, stopRecording])

  useEffect(() => {
    return () => {
      stopWakeRecognition()
      wakeRecognitionRef.current = null
      wakeRecognitionActiveRef.current = false
      stopCurrentRequest()
      clearRecordingWatchdog()
      stopMediaStream()
      stopPlayback()
      if (audioRef.current) {
        URL.revokeObjectURL(audioRef.current.src)
      }
    }
  }, [
    clearRecordingWatchdog,
    stopCurrentRequest,
    stopMediaStream,
    stopPlayback,
    stopWakeRecognition,
  ])

  return {
    state,
    transcript,
    response,
    error,
    toggleRecording,
    wakeWordEnabled,
    wakeWordSupported,
  }
}
