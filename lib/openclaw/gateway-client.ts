import { randomBytes } from "node:crypto"

import { createTimeoutError, isTimeoutError, withTimeout } from "../middleware/timeout"
import {
  gatewayAgentEventSchema,
  gatewayChatCompleteEventSchema,
  gatewayChatEventSchema,
  gatewayChatSendRequestSchema,
  gatewayChatTokenEventSchema,
  gatewayConnectChallengeSchema,
  gatewayConnectedEventSchema,
  gatewayErrorEventSchema,
  gatewayIncomingMessageSchema,
  gatewayResponseSchema,
  gatewayOutgoingMessageSchema,
  type GatewayIncomingMessage,
  type GatewayOutgoingMessage,
} from "./gateway.schema"
import {
  GATEWAY_DEFAULT_MAX_RETRY_ATTEMPTS,
  GATEWAY_DEFAULT_RECONNECT_DELAYS_MS,
  GATEWAY_DEFAULT_TIMEOUT_MS,
  resolveGatewayReconnectDelayMs,
} from "./constants"
import {
  GatewayClientError,
  type GatewayChatInput,
  type GatewayChatResult,
  type GatewaySocketFactory,
} from "./gateway.types"

const isBrowserWebSocket = () => typeof WebSocket !== "undefined"

const normalizeGatewaySocketUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim().replace(/\/+$/, "")
  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -3)
  }
  if (/^wss:\/\//i.test(trimmed) || /^ws:\/\//i.test(trimmed)) {
    return trimmed
  }
  throw new Error("OPENCLAW_GATEWAY_URL must use ws:// or wss://")
}

const randomId = () => randomBytes(12).toString("hex")

const parseIncomingMessage = (data: unknown): GatewayIncomingMessage => {
  if (typeof data !== "string") {
    throw new GatewayClientError("Gateway message is not a string", {
      code: "protocol",
      retryable: false,
    })
  }

  const payload = JSON.parse(data) as unknown
  return gatewayIncomingMessageSchema.parse(payload)
}

const parseAndValidateOutgoing = (payload: GatewayOutgoingMessage): GatewayOutgoingMessage => {
  return gatewayOutgoingMessageSchema.parse(payload)
}

const sendFrame = (socket: ReturnType<GatewaySocketFactory>, frame: GatewayOutgoingMessage) => {
  const validated = parseAndValidateOutgoing(frame)
  socket.send(JSON.stringify(validated))
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error")

const resolveGatewaySessionKey = (conversationId?: string) => {
  if (!conversationId || !conversationId.trim()) {
    return "agent:main:main"
  }

  const trimmed = conversationId.trim()
  if (trimmed.startsWith("agent:")) {
    return trimmed
  }

  return `agent:main:${trimmed}`
}

const extractChatText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const message = (payload as { message?: unknown }).message
  if (!message || typeof message !== "object") {
    return null
  }

  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) {
    return null
  }

  const text = content
    .map((entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { text?: unknown }).text === "string"
        ? (entry as { text: string }).text
        : ""
    )
    .join("")
    .trim()

  return text.length ? text : null
}

const upsertPartialText = (
  current: string,
  delta: string | undefined,
  fullText: string | undefined
) => {
  if (delta && delta.length) {
    return `${current}${delta}`
  }

  if (!fullText || !fullText.length) {
    return current
  }

  if (fullText.startsWith(current)) {
    return fullText
  }

  if (current.endsWith(fullText)) {
    return current
  }

  return `${current}${fullText}`
}

export const createDefaultGatewaySocketFactory = (url: string): ReturnType<GatewaySocketFactory> => {
  if (!isBrowserWebSocket()) {
    throw new GatewayClientError("WebSocket is not available", {
      code: "connection",
      retryable: false,
    })
  }
  return new WebSocket(url)
}

const withGatewayConnection = async <T>(
  url: string,
  input: {
    socketFactory: GatewaySocketFactory
    execute: (socket: ReturnType<GatewaySocketFactory>) => Promise<T>
    signal?: AbortSignal
  }
): Promise<T> => {
  const socket = input.socketFactory(url)
  if (!socket) {
    throw new GatewayClientError("Gateway socket creation failed", {
      code: "connection",
      retryable: true,
    })
  }

  const cleanup = () => {
    socket.close()
  }

  const run = new Promise<T>((resolve, reject) => {
    if (input.signal?.aborted) {
      return reject(input.signal.reason || createTimeoutError(0))
    }

    const onAbort = () => {
      cleanup()
      reject(input.signal?.reason ?? createTimeoutError(0))
    }

    input.signal?.addEventListener("abort", onAbort, { once: true })

    void input.execute(socket).then(
      (result) => {
        input.signal?.removeEventListener("abort", onAbort)
        cleanup()
        resolve(result)
      },
      (error) => {
        input.signal?.removeEventListener("abort", onAbort)
        cleanup()
        reject(error)
      }
    )
  })

  return run
}

const connectAndChat = async (
  socket: ReturnType<GatewaySocketFactory>,
  input: {
    gatewayToken: string
    conversationId?: string
    metadata?: Record<string, unknown>
    text: string
    deviceId?: string
  }
): Promise<GatewayChatResult> => {
  const connectRequestId = randomId()
  const chatRequestId = randomId()
  const waitRequestId = randomId()
  const sessionKey = resolveGatewaySessionKey(input.conversationId)

  const state = {
    connected: false,
    runId: null as string | null,
    completeText: null as string | null,
    partialText: "",
    completeResolver: null as ((value: GatewayChatResult) => void) | null,
    completeRejector: null as ((error: unknown) => void) | null,
    openResolver: null as (() => void) | null,
    done: false,
  }

  const complete = new Promise<GatewayChatResult>((resolve, reject) => {
    state.completeResolver = resolve
    state.completeRejector = reject
  })
  complete.catch(() => undefined)
  const waitForOpen = new Promise<void>((resolve) => {
    state.openResolver = resolve
  })

  const finalize = (result: GatewayChatResult) => {
    if (state.done) {
      return
    }
    state.done = true
    state.completeResolver?.(result)
  }

  const rejectWith = (error: unknown) => {
    if (state.done) {
      return
    }
    state.done = true
    state.completeRejector?.(error)
  }

  const buildResult = (): GatewayChatResult => ({
    text: state.completeText || state.partialText,
    conversationId: input.conversationId ?? sessionKey,
    partialText: state.partialText,
  })

  const onOpen = () => {
    if (!state.done) {
      state.openResolver?.()
    }
  }

  const onClose = () => {
    if (state.completeResolver && state.completeRejector && !state.done) {
      rejectWith(
        new GatewayClientError("Gateway closed before completion", {
          code: "incomplete_stream",
          partialText: state.partialText,
          retryable: true,
          details: { partialText: state.partialText },
        })
      )
    }
  }

  const onError = () => {
    rejectWith(
      new GatewayClientError("Gateway socket error", {
        code: "connection",
        retryable: true,
      })
    )
  }

  const shouldTrackRunId = (runId: string | null | undefined) => {
    if (!runId) {
      return false
    }
    if (!state.runId) {
      return true
    }
    return state.runId === runId
  }

  const handleMessage = (event: MessageEvent | Event) => {
    if (state.done) {
      return
    }

    const parsed = parseIncomingMessage((event as MessageEvent).data)

    if (gatewayConnectChallengeSchema.safeParse(parsed).success) {
      return
    }

    if (gatewayConnectedEventSchema.safeParse(parsed).success) {
      state.connected = true
      return
    }

    if (gatewayChatTokenEventSchema.safeParse(parsed).success) {
      const tokenPayload = gatewayChatTokenEventSchema.parse(parsed)
      state.partialText = upsertPartialText(state.partialText, tokenPayload.payload.token, undefined)
      return
    }

    if (gatewayChatCompleteEventSchema.safeParse(parsed).success) {
      const completePayload = gatewayChatCompleteEventSchema.parse(parsed)
      state.completeText = completePayload.payload.text
      finalize(buildResult())
      return
    }

    if (gatewayAgentEventSchema.safeParse(parsed).success) {
      const agentPayload = gatewayAgentEventSchema.parse(parsed)
      if (!shouldTrackRunId(agentPayload.payload.runId)) {
        return
      }

      if (!state.runId) {
        state.runId = agentPayload.payload.runId
      }

      if (agentPayload.payload.stream === "assistant") {
        const data = agentPayload.payload.data
        const delta = typeof data?.delta === "string" ? data.delta : undefined
        const text = typeof data?.text === "string" ? data.text : undefined
        state.partialText = upsertPartialText(state.partialText, delta, text)
        return
      }

      if (
        agentPayload.payload.stream === "lifecycle" &&
        agentPayload.payload.data &&
        typeof agentPayload.payload.data === "object" &&
        (agentPayload.payload.data as { phase?: unknown }).phase === "end"
      ) {
        if (!state.completeText && state.partialText.trim().length > 0) {
          finalize(buildResult())
        }
        return
      }

      return
    }

    if (gatewayChatEventSchema.safeParse(parsed).success) {
      const chatPayload = gatewayChatEventSchema.parse(parsed)
      const runId = chatPayload.payload.runId
      if (!shouldTrackRunId(runId)) {
        return
      }
      if (!state.runId && runId) {
        state.runId = runId
      }

      const extractedText = extractChatText(chatPayload.payload)
      if (chatPayload.payload.state === "final") {
        if (extractedText) {
          state.completeText = extractedText
        }
        finalize(buildResult())
        return
      }

      if (extractedText) {
        state.partialText = upsertPartialText(state.partialText, undefined, extractedText)
      }
      return
    }

    if (gatewayErrorEventSchema.safeParse(parsed).success) {
      const errorPayload = gatewayErrorEventSchema.parse(parsed)
      rejectWith(
        new GatewayClientError(errorPayload.payload.message, {
          code: "protocol",
          details: {
            code: errorPayload.payload.code,
            details: errorPayload.payload.details,
          },
          partialText: state.partialText,
          retryable: false,
        })
      )
      return
    }

    if (gatewayResponseSchema.safeParse(parsed).success) {
      const response = gatewayResponseSchema.parse(parsed)
      const ok = (response as { ok?: unknown }).ok
      const error = response.error

      if (response.id === connectRequestId) {
        if (error || ok === false) {
          rejectWith(
            new GatewayClientError(error?.message || "Gateway connect failed", {
              code: "protocol",
              details: {
                code: error?.code,
                details: error?.details,
              },
              retryable: false,
            })
          )
          return
        }

        state.connected = true
        return
      }

      if (response.id === chatRequestId) {
        if (error || ok === false) {
          rejectWith(
            new GatewayClientError(error?.message || "Gateway chat request failed", {
              code: "upstream",
              details: { code: error?.code, details: error?.details },
              partialText: state.partialText,
              retryable: false,
            })
          )
          return
        }

        const payload = (response as { payload?: unknown }).payload
        const runId =
          payload && typeof payload === "object" && typeof (payload as { runId?: unknown }).runId === "string"
            ? (payload as { runId: string }).runId
            : null

        if (runId) {
          state.runId = runId
          sendFrame(socket, {
            id: waitRequestId,
            type: "req",
            method: "agent.wait",
            params: {
              runId,
            },
          })
        }
        return
      }

      if (response.id === waitRequestId) {
        if (error || ok === false) {
          rejectWith(
            new GatewayClientError(error?.message || "Gateway wait request failed", {
              code: "upstream",
              details: { code: error?.code, details: error?.details },
              partialText: state.partialText,
              retryable: false,
            })
          )
          return
        }

        if ((state.completeText || state.partialText).trim().length > 0) {
          finalize(buildResult())
          return
        }
      }
      return
    }
  }

  socket.addEventListener("open", onOpen)
  socket.addEventListener("message", (event) => {
    try {
      handleMessage(event as MessageEvent)
    } catch (error) {
      rejectWith(
        new GatewayClientError(`Gateway protocol parse error: ${getErrorMessage(error)}`, {
          code: "protocol",
          retryable: false,
        })
      )
    }
  })
  socket.addEventListener("close", onClose)
  socket.addEventListener("error", onError)

  await waitForOpen
  if (state.done) {
    throw new GatewayClientError("Gateway request aborted during connection", {
      code: "connection",
      retryable: true,
    })
  }

  sendFrame(socket, {
    id: connectRequestId,
    type: "req",
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "cli",
        version: "1.0.0",
        platform: "linux",
        mode: "node",
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [],
      commands: [],
      permissions: {},
      auth: {
        token: input.gatewayToken,
      },
      locale: "en-US",
      userAgent: "openclaw-hal-assistant/1.0.0",
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    },
  })

  while (!state.connected) {
    if (state.done) {
      return complete
    }
    await sleep(25)
  }

  sendFrame(socket, gatewayChatSendRequestSchema.parse({
    id: chatRequestId,
    type: "req",
    method: "chat.send",
    params: {
      sessionKey,
      message: input.text,
      idempotencyKey: randomId(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  }))

  return complete
}

export const chatWithGateway = async (input: GatewayChatInput): Promise<GatewayChatResult> => {
  const cfg = {
    timeoutMs: GATEWAY_DEFAULT_TIMEOUT_MS,
    maxRetryAttempts: GATEWAY_DEFAULT_MAX_RETRY_ATTEMPTS,
    reconnectDelaysMs: GATEWAY_DEFAULT_RECONNECT_DELAYS_MS,
    ...input,
  }

  const normalizedUrl = normalizeGatewaySocketUrl(cfg.gatewayUrl)
  const socketFactory = cfg.socketFactory ?? createDefaultGatewaySocketFactory

  let latestError: unknown = null
  let partialText = ""

  for (let attempt = 0; attempt < cfg.maxRetryAttempts; attempt += 1) {
    try {
      return await withTimeout(async (signal) => {
        const response = await withGatewayConnection(normalizedUrl, {
          socketFactory,
          signal,
          execute: (socket) =>
            connectAndChat(socket, {
              gatewayToken: cfg.gatewayToken,
              conversationId: cfg.conversationId,
              metadata: cfg.metadata,
              text: cfg.text,
              deviceId: cfg.deviceId,
            }),
        })

        return response
      }, cfg.timeoutMs)
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new GatewayClientError("Gateway chat request timed out", {
          code: "timeout",
          retryable: false,
          cause: error,
        })
      }

      if (error instanceof GatewayClientError) {
        latestError = error
        if (!error.retryable) {
          throw error
        }

        if (attempt < cfg.maxRetryAttempts - 1) {
          partialText = error.partialText || partialText
          await sleep(resolveGatewayReconnectDelayMs(attempt, cfg.reconnectDelaysMs))
          continue
        }
      }

      if (attempt >= cfg.maxRetryAttempts - 1) {
        if (latestError) {
          throw latestError
        }
        throw error
      }
    }
  }

  const finalError = latestError ?? new GatewayClientError("Gateway request failed after retries", {
    code: "connection",
    retryable: false,
    partialText,
  })
  throw finalError
}
