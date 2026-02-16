import { createHmac, randomBytes } from "node:crypto"

import { createTimeoutError, isTimeoutError, withTimeout } from "../middleware/timeout"
import {
  gatewayConnectChallengeSchema,
  gatewayConnectedEventSchema,
  gatewayErrorEventSchema,
  gatewayIncomingMessageSchema,
  gatewayResponseSchema,
  gatewayChatTokenEventSchema,
  gatewayChatCompleteEventSchema,
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
  if (/^https:\/\//i.test(trimmed)) {
    return `wss://${trimmed.slice(8)}`
  }
  if (/^http:\/\//i.test(trimmed)) {
    return `ws://${trimmed.slice(7)}`
  }
  return `wss://${trimmed}`
}

const randomId = () => randomBytes(12).toString("hex")

const isChallengeAuthFailure = (code: string) => {
  const normalized = code.toLowerCase()
  return ["challenge_auth_failed", "challenge-invalid", "signature_mismatch", "auth_failed"].includes(
    normalized
  )
}

const formatSignedChallengeResponse = (challenge: string, token: string) => {
  return createHmac("sha256", token).update(challenge).digest("base64url")
}

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

  const state = {
    connected: false,
    challenge: null as string | null,
    didChallengeRespondSigned: false,
    completeText: null as string | null,
    conversationId: input.conversationId ?? "",
    completePayloadConversationId: null as string | null,
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

  const respondToChallenge = (challenge: string, sign: boolean) => {
    sendFrame(socket, {
      id: randomId(),
      type: "req",
      method: "connect.respond",
      params: {
        response: sign
          ? formatSignedChallengeResponse(challenge, input.gatewayToken)
          : challenge,
      },
    })
  }

  const handleMessage = (event: MessageEvent | Event) => {
    if (state.done) {
      return
    }

    const parsed = parseIncomingMessage((event as MessageEvent).data)

    if (gatewayConnectChallengeSchema.safeParse(parsed).success) {
      const challengePayload = gatewayConnectChallengeSchema.parse(parsed)
      state.challenge = challengePayload.payload.challenge
      respondToChallenge(state.challenge, state.didChallengeRespondSigned)
      return
    }

    if (gatewayConnectedEventSchema.safeParse(parsed).success) {
      state.connected = true
      return
    }

    if (gatewayChatTokenEventSchema.safeParse(parsed).success) {
      const tokenPayload = gatewayChatTokenEventSchema.parse(parsed)
      state.partialText += tokenPayload.payload.token
      return
    }

    if (gatewayChatCompleteEventSchema.safeParse(parsed).success) {
      const completePayload = gatewayChatCompleteEventSchema.parse(parsed)
      state.completePayloadConversationId = completePayload.payload.conversationId
      state.completeText = completePayload.payload.text
      finalize({
        text: state.completeText || state.partialText,
        conversationId: state.completePayloadConversationId || state.conversationId,
        partialText: state.partialText,
      })
      return
    }

    if (gatewayErrorEventSchema.safeParse(parsed).success) {
      const errorPayload = gatewayErrorEventSchema.parse(parsed)
      if (
        !state.didChallengeRespondSigned &&
        state.challenge &&
        isChallengeAuthFailure(errorPayload.payload.code)
      ) {
        state.didChallengeRespondSigned = true
        respondToChallenge(state.challenge, true)
        return
      }

      const code = errorPayload.payload.code
      rejectWith(
        new GatewayClientError(errorPayload.payload.message, {
          code:
            isChallengeAuthFailure(code) && state.didChallengeRespondSigned
              ? "challenge_auth_failed"
              : "protocol",
          details: {
            code,
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
      if (response.id === connectRequestId && response.error) {
        rejectWith(
          new GatewayClientError(response.error.message, {
            code: "protocol",
            details: { code: response.error.code, details: response.error.details },
            retryable: false,
          })
        )
        return
      }
      if (response.id === connectRequestId && response.result) {
        state.connected = true
        return
      }
      if (response.id === chatRequestId && response.error) {
        rejectWith(
          new GatewayClientError(response.error.message, {
            code: "upstream",
            details: { code: response.error.code, details: response.error.details },
            partialText: state.partialText,
          })
        )
        return
      }
      return
    }
  }

  socket.addEventListener("open", onOpen)
  socket.addEventListener("message", (event) => {
    try {
      handleMessage(event as MessageEvent)
    } catch (error) {
      rejectWith(error)
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
      token: input.gatewayToken,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    },
  })

  while (!state.connected) {
    if (state.done) {
      throw new GatewayClientError("Gateway connection did not complete", {
        code: "connection",
        retryable: true,
      })
    }
    await sleep(25)
  }

  sendFrame(socket, {
    id: chatRequestId,
    type: "req",
    method: "chat.send",
    params: {
      text: input.text,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  })

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
