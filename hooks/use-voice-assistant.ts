"use client"

import { useState, useRef, useCallback } from "react"
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

export function useVoiceAssistant(): UseVoiceAssistantReturn {
  const [state, setState] = useState<HalState>("idle")
  const [transcript, setTranscript] = useState("")
  const [response, setResponse] = useState("")
  const [error, setError] = useState("")

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const conversationHistoryRef = useRef<Message[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const processAudio = useCallback(async (audioBlob: Blob) => {
    setState("processing")
    setError("")

    try {
      // Step 1: Speech-to-Text
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

      if (!userText || userText.trim().length === 0) {
        throw new Error("Could not understand the audio. Please try again.")
      }

      setTranscript(userText)

      // Step 2: Send to OpenClaw via chat route
      const chatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          conversationHistory: conversationHistoryRef.current,
        }),
      })

      if (!chatResponse.ok) {
        const chatError = await chatResponse.json()
        throw new Error(chatError.error || "Chat completion failed")
      }

      const { text: assistantText, conversationHistory } =
        await chatResponse.json()

      conversationHistoryRef.current = conversationHistory
      setResponse(assistantText)

      // Step 3: Text-to-Speech
      setState("speaking")

      const ttsResponse = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: assistantText }),
      })

      if (!ttsResponse.ok) {
        // If TTS fails, still show the response text but log the error
        console.error("TTS failed, response text is shown instead")
        setState("idle")
        return
      }

      const audioBuffer = await ttsResponse.arrayBuffer()
      const audioBlob2 = new Blob([audioBuffer], { type: "audio/mpeg" })
      const audioUrl = URL.createObjectURL(audioBlob2)

      // Play the audio
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }

      const audio = new Audio(audioUrl)
      audioRef.current = audio

      audio.onended = () => {
        setState("idle")
        URL.revokeObjectURL(audioUrl)
      }

      audio.onerror = () => {
        setState("idle")
        URL.revokeObjectURL(audioUrl)
      }

      await audio.play()
    } catch (err) {
      console.error("Voice assistant error:", err)
      setError(err instanceof Error ? err.message : "An unexpected error occurred")
      setState("idle")
    }
  }, [])

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
        stopMediaStream()
        processAudio(audioBlob)
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setState("recording")
    } catch (err) {
      console.error("Failed to start recording:", err)
      setError(
        "Microphone access denied. Please allow microphone access and try again."
      )
      setState("idle")
    }
  }, [processAudio, stopMediaStream])

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const toggleRecording = useCallback(() => {
    if (state === "idle") {
      startRecording()
    } else if (state === "recording") {
      stopRecording()
    }
    // Do nothing if processing or speaking
  }, [state, startRecording, stopRecording])

  return {
    state,
    transcript,
    response,
    error,
    toggleRecording,
  }
}
