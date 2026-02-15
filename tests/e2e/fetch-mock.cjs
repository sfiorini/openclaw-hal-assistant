const { Buffer } = require("node:buffer")

const chatPayload = {
  choices: [{
    message: {
      content: "Mocked response from OpenClaw.",
      role: "assistant",
    },
  }],
}

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

const isOpenClawChat = (url) => typeof url === "string" && url.includes("/v1/chat/completions")

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

    if (isOpenClawChat(rawUrl)) {
      return createJsonResponse(chatPayload)
    }

    if (isOpenClawModels(rawUrl)) {
      return createJsonResponse(modelsPayload)
    }

    return originalFetch(input, init)
  }
}
