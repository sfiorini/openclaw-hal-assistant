const { Buffer } = require("node:buffer")

const sttPayload = {
  text: "what is the weather",
}

const audioPayload = Buffer.from([73, 68, 51, 3, 0, 0, 0])

const modelsPayload = {
  data: [{ id: "main" }],
}

const jsonHeaders = { "Content-Type": "application/json" }

const createJsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: jsonHeaders,
    ...init,
  })

const createBinaryResponse = () =>
  new Response(audioPayload, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": audioPayload.length.toString(),
    },
  })

const isOpenClawModels = (url) => typeof url === "string" && url.includes("/v1/models")

const originalFetch = globalThis.fetch

if (typeof globalThis.fetch === "function") {
  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    if (typeof rawUrl !== "string") {
      return originalFetch(input, init)
    }

    if (rawUrl.includes("api.elevenlabs.io/v1/speech-to-text")) {
      return createJsonResponse(sttPayload)
    }

    if (rawUrl.includes("api.elevenlabs.io/v1/text-to-speech/")) {
      return createBinaryResponse()
    }

    if (isOpenClawModels(rawUrl)) {
      return createJsonResponse(modelsPayload)
    }

    return originalFetch(input, init)
  }
}

let runCounter = 0

class MockGatewayWebSocket {
  constructor(url) {
    this.url = String(url)
    this.readyState = 1
    this.listeners = {
      open: new Set(),
      message: new Set(),
      close: new Set(),
      error: new Set(),
    }

    queueMicrotask(() => {
      this.emit("open", { type: "open" })
    })
  }

  addEventListener(type, listener) {
    this.listeners[type]?.add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners[type]?.delete(listener)
  }

  emit(type, payload) {
    const listeners = this.listeners[type]
    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(payload)
    }
  }

  emitMessage(payload) {
    this.emit("message", {
      type: "message",
      data: JSON.stringify(payload),
    })
  }

  send(frame) {
    let parsed

    try {
      parsed = JSON.parse(frame)
    } catch {
      return
    }

    const { id, method, params } = parsed

    if (method === "connect") {
      queueMicrotask(() => {
        this.emitMessage({
          type: "res",
          id,
          ok: true,
          payload: { protocol: 3 },
        })
      })
      return
    }

    if (method === "connect.respond") {
      queueMicrotask(() => {
        this.emitMessage({
          type: "res",
          id,
          ok: true,
        })
      })
      return
    }

    if (method === "chat.send") {
      const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey : "agent:main:e2e-mock-session-id"
      const runId = `run-${++runCounter}`

      queueMicrotask(() => {
        this.emitMessage({
          type: "res",
          id,
          ok: true,
          payload: { runId, status: "started", sessionKey },
        })

        this.emitMessage({
          type: "event",
          event: "chat",
          payload: {
            runId,
            state: "final",
            sessionKey,
            message: {
              role: "assistant",
              content: [{ type: "text", text: "OpenClaw reports clear skies." }],
            },
          },
        })
      })
      return
    }

    if (method === "agent.wait") {
      queueMicrotask(() => {
        this.emitMessage({
          type: "res",
          id,
          ok: true,
          payload: { status: "completed" },
        })
      })
    }
  }

  close() {
    this.readyState = 3
    this.emit("close", { type: "close" })
  }
}

globalThis.WebSocket = MockGatewayWebSocket
