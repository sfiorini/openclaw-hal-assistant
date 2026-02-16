import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { chatWithGateway } from "../../../lib/openclaw/gateway-client"

type GatewayMessageHandler = (event: MessageEvent | Event) => void

class MockGatewaySocket {
  private listeners = new Map<string, Set<GatewayMessageHandler>>()
  public sentMessages: string[] = []
  public closed = false

  constructor(public readonly url: string) {
    this.listeners.set("open", new Set())
    this.listeners.set("message", new Set())
    this.listeners.set("close", new Set())
    this.listeners.set("error", new Set())

    queueMicrotask(() => {
      this.emit("open", {})
    })
  }

  addEventListener(type: string, listener: GatewayMessageHandler) {
    this.listeners.get(type)?.add(listener)
  }

  removeEventListener(type: string, listener: GatewayMessageHandler) {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    this.sentMessages.push(data)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.emit("close", { type: "close", code: 1000, reason: "closed" })
  }

  emit(type: "open" | "message" | "close" | "error", event: unknown): void {
    this.listeners.get(type)?.forEach((listener) => {
      listener(event as MessageEvent | Event)
    })
  }

  emitMessage(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) })
  }
}

class MockGatewaySocketFactory {
  public sockets: MockGatewaySocket[] = []

  create = (url: string): MockGatewaySocket => {
    const socket = new MockGatewaySocket(url)
    this.sockets.push(socket)
    return socket
  }
}

const getLastSentFrame = (socket: MockGatewaySocket, index: number) => {
  const raw = socket.sentMessages[index]
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

const signChallenge = (challenge: string, token: string) =>
  createHmac("sha256", token).update(challenge).digest("base64url")

const waitForSocketFrame = async (
  factory: MockGatewaySocketFactory,
  socketIndex: number,
  frameIndex: number
) => {
  await vi.waitFor(() => {
    expect(factory.sockets[socketIndex]).toBeDefined()
    expect(factory.sockets[socketIndex].sentMessages.length).toBeGreaterThan(frameIndex)
  })

  return getLastSentFrame(factory.sockets[socketIndex], frameIndex)
}

describe("gateway client", () => {
  it("retries raw challenge response with signed response", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "wss://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForSocketFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    expect(connectFrame?.method).toBe("connect")
    const connectId = String(connectFrame?.id)

    socket.emitMessage({
      type: "event",
      id: connectId,
      event: "connect.challenge",
      payload: { challenge: "openclaw-challenge" },
    })

    const rawRespond = getLastSentFrame(socket, 1)
    expect(rawRespond?.method).toBe("connect.respond")
    expect(rawRespond?.params).toMatchObject({ response: "openclaw-challenge" })

    socket.emitMessage({
      type: "event",
      id: connectId,
      event: "error",
      payload: { code: "challenge_auth_failed", message: "challenge failed" },
    })

    const signedRespond = getLastSentFrame(socket, 2)
    expect(signedRespond?.method).toBe("connect.respond")
    expect((signedRespond?.params as Record<string, unknown>)?.response).toBe(
      signChallenge("openclaw-challenge", "gateway-token")
    )

    socket.emitMessage({
      type: "event",
      id: connectId,
      event: "connect.success",
      payload: { sessionId: "session-1" },
    })

    socket.emitMessage({
      type: "event",
      event: "chat.complete",
      payload: { text: "pong", conversationId: "conversation-1" },
    })

    await expect(request).resolves.toMatchObject({
      text: "pong",
      conversationId: "conversation-1",
    })
  })

  it("streams token events and resolves with final completion text", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "wss://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForSocketFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    const connectId = String(connectFrame?.id)

    socket.emitMessage({
      type: "event",
      id: connectId,
      event: "connect.challenge",
      payload: { challenge: "stream-challenge" },
    })

    socket.emitMessage({
      type: "event",
      id: connectId,
      event: "connect.success",
      payload: { sessionId: "session-2" },
    })

    socket.emitMessage({
      type: "event",
      event: "chat.token",
      payload: { token: "Hell" },
    })
    socket.emitMessage({
      type: "event",
      event: "chat.token",
      payload: { token: "o " },
    })

    socket.emitMessage({
      type: "event",
      event: "chat.complete",
      payload: { text: "Hello!", conversationId: "conversation-2" },
    })

    await expect(request).resolves.toMatchObject({
      text: "Hello!",
      conversationId: "conversation-2",
      partialText: "Hello ",
    })
  })

  it("returns protocol error with partial text when an error is encountered mid-stream", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "wss://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForSocketFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    const connectId = String(connectFrame?.id)

    socket.emitMessage({
      type: "event",
      id: connectId,
      event: "connect.challenge",
      payload: { challenge: "error-challenge" },
    })
    socket.emitMessage({
      type: "event",
      id: connectId,
      event: "connect.success",
      payload: { sessionId: "session-3" },
    })
    socket.emitMessage({
      type: "event",
      event: "chat.token",
      payload: { token: "working" },
    })
    socket.emitMessage({
      type: "event",
      event: "error",
      payload: { code: "tool_error", message: "Tool failed" },
    })
    await Promise.resolve()

    await expect(request).rejects.toMatchObject({
      name: "GatewayClientError",
      code: "protocol",
      partialText: "working",
    })
    socket.close()
  })

  it("retries when stream closes during completion", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "wss://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 2,
      reconnectDelaysMs: [0],
    })

    const firstConnectFrame = await waitForSocketFrame(factory, 0, 0)
    const first = factory.sockets[0]
    const firstConnectId = String(firstConnectFrame?.id)
    first.emitMessage({
      type: "event",
      id: firstConnectId,
      event: "connect.challenge",
      payload: { challenge: "retry-challenge" },
    })
    first.emitMessage({
      type: "event",
      id: firstConnectId,
      event: "connect.success",
      payload: { sessionId: "session-retry" },
    })
    first.emitMessage({
      type: "event",
      event: "chat.token",
      payload: { token: "partial" },
    })
    first.close()
    await Promise.resolve()

    await vi.waitFor(
      () => {
        expect(factory.sockets.length).toBeGreaterThan(1)
      },
      {
        timeout: 5000,
      }
    )
    const second = factory.sockets[1]
    const secondConnectFrame = await waitForSocketFrame(factory, 1, 0)
    const secondConnectId = String(secondConnectFrame?.id)

    second.emitMessage({
      type: "event",
      id: secondConnectId,
      event: "connect.challenge",
      payload: { challenge: "retry-challenge-2" },
    })
    second.emitMessage({
      type: "event",
      id: secondConnectId,
      event: "connect.success",
      payload: { sessionId: "session-retry-2" },
    })
    second.emitMessage({
      type: "event",
      event: "chat.complete",
      payload: { text: "recovered", conversationId: "conversation-3" },
    })

    await expect(request).resolves.toMatchObject({
      text: "recovered",
      conversationId: "conversation-3",
    })
    expect(factory.sockets).toHaveLength(2)
  })
})
