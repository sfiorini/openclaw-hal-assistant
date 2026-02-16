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

const extractWakeText = (results: ArrayLike<WakeWordResult> | undefined, wakeWord: string) => {
  if (!results || typeof results.length !== "number") {
    return null
  }

  const wake = wakeWord.trim().toLowerCase()
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (!result || !result.isFinal) {
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
  const conversationHistoryRef = useRef<Message[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakingTimeoutRef = useRef<number | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const wakeRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    setWakeWordSupported(Boolean(resolveSpeechRecognitionCtor()))
  }, [wakeWordEnabled, wakeWord])

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

    wakeRecognitionRef.current = null

    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null

    try {
      recognition.stop()
    } catch {
      // best effort
    }
  }, [])

  const processAudio = useCallback(
    async (audioBlob: Blob) => {
      stopMediaStream()
      stopWakeRecognition()
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
          signal: requestController.signal,
        })

        if (!chatResponse.ok) {
          const chatErrorMessage = await readApiErrorMessage(chatResponse, "Chat completion failed")
          throw new Error(chatErrorMessage)
        }

        const payload = (await chatResponse.json()) as unknown
        const chatPayload = parseChatSubmitResponse(payload)

        setSessionId(chatPayload.sessionId)
        conversationHistoryRef.current = chatPayload.conversationHistory
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
    } catch (recordError) {
      console.error("Failed to start recording:", recordError)
      setError("Microphone access denied. Please allow microphone access and try again.")
      setState("idle")
    }
  }, [processAudio])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
  }, [])

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

    if (stateRef.current !== "idle") {
      return
    }

    if (wakeRecognitionRef.current) {
      return
    }

    const recognition = new constructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onresult = (event: { results: ArrayLike<WakeWordResult> }) => {
      const detected = extractWakeText(event.results, wakeWord)
      if (!detected) {
        return
      }

      stopWakeRecognition()

      if (stateRef.current !== "idle") {
        return
      }

      void startRecording()
    }

    recognition.onerror = () => {
      stopWakeRecognition()
    }

    recognition.onend = () => {
      wakeRecognitionRef.current = null
      if (wakeWordEnabled && stateRef.current === "idle") {
        startWakeRecognition()
      }
    }

    wakeRecognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      stopWakeRecognition()
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
      startWakeRecognition()
    } else {
      stopWakeRecognition()
    }
  }, [state, wakeWordEnabled, wakeWord, startWakeRecognition, stopWakeRecognition])

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
      abortAndReset()
      return
    }

    if (state === "speaking") {
      stopPlayback()
      startRecording()
      return
    }

    // processing currently internal only
  }, [abortAndReset, startRecording, state, stopPlayback, stopRecording])

  useEffect(() => {
    return () => {
      stopWakeRecognition()
      stopCurrentRequest()
      stopMediaStream()
      stopPlayback()
      if (audioRef.current) {
        URL.revokeObjectURL(audioRef.current.src)
      }
    }
  }, [stopCurrentRequest, stopMediaStream, stopPlayback, stopWakeRecognition])

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
