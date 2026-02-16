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

const getFrame = (socket: MockGatewaySocket, index: number) => {
  const raw = socket.sentMessages[index]
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

const waitForFrame = async (
  factory: MockGatewaySocketFactory,
  socketIndex: number,
  frameIndex: number
) => {
  await vi.waitFor(() => {
    expect(factory.sockets[socketIndex]).toBeDefined()
    expect(factory.sockets[socketIndex].sentMessages.length).toBeGreaterThan(frameIndex)
  })

  return getFrame(factory.sockets[socketIndex], frameIndex)
}

describe("gateway client", () => {
  it("connects with protocol v3 and resolves from chat final event", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "ws://gateway.example.com",
      gatewayToken: "gateway-token",
      agentId: "assistant",
      conversationId: "11111111-1111-4111-8111-111111111111",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    const connectId = String(connectFrame?.id)

    expect(connectFrame?.method).toBe("connect")
    expect((connectFrame?.params as Record<string, unknown>)?.minProtocol).toBe(3)

    socket.emitMessage({
      type: "res",
      id: connectId,
      ok: true,
      payload: { protocol: 3 },
    })

    const chatFrame = await waitForFrame(factory, 0, 1)
    const chatId = String(chatFrame?.id)
    expect(chatFrame?.method).toBe("chat.send")
    expect((chatFrame?.params as Record<string, unknown>)?.sessionKey).toBe(
      "agent:assistant:11111111-1111-4111-8111-111111111111"
    )

    socket.emitMessage({
      type: "res",
      id: chatId,
      ok: true,
      payload: { runId: "run-1", status: "started" },
    })

    socket.emitMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "pong" }],
        },
      },
    })

    await expect(request).resolves.toMatchObject({
      text: "pong",
      conversationId: "11111111-1111-4111-8111-111111111111",
    })
  })

  it("ignores connect.challenge and still proceeds with chat", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "ws://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    const connectId = String(connectFrame?.id)

    socket.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: {
        nonce: "challenge-nonce",
      },
    })

    socket.emitMessage({
      type: "res",
      id: connectId,
      ok: true,
      payload: { protocol: 3 },
    })

    const chatFrame = await waitForFrame(factory, 0, 1)
    const chatId = String(chatFrame?.id)

    socket.emitMessage({
      type: "res",
      id: chatId,
      ok: true,
      payload: { runId: "run-1", status: "started" },
    })

    socket.emitMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ready" }],
        },
      },
    })

    await expect(request).resolves.toMatchObject({
      text: "ready",
    })
  })

  it("continues normal flow when challenge event is emitted", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "ws://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    const connectId = String(connectFrame?.id)

    socket.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: {
        nonce: "challenge-nonce",
      },
    })

    socket.emitMessage({
      type: "res",
      id: connectId,
      ok: true,
      payload: { protocol: 3 },
    })

    const chatFrame = await waitForFrame(factory, 0, 1)
    const chatId = String(chatFrame?.id)
    socket.emitMessage({
      type: "res",
      id: chatId,
      ok: true,
      payload: { runId: "run-1", status: "started" },
    })

    socket.emitMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "signed ok" }],
        },
      },
    })

    await expect(request).resolves.toMatchObject({
      text: "signed ok",
    })
  })

  it("returns protocol error when connect response is invalid", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "ws://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    const connectId = String(connectFrame?.id)

    socket.emitMessage({
      type: "res",
      id: connectId,
      ok: false,
      error: { code: "INVALID_REQUEST", message: "bad connect payload" },
    })

    await expect(request).rejects.toMatchObject({
      name: "GatewayClientError",
      code: "protocol",
    })
  })

  it("ignores events from unrelated runs, including pre-ack events", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "ws://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 1,
    })

    const connectFrame = await waitForFrame(factory, 0, 0)
    const socket = factory.sockets[0]
    const connectId = String(connectFrame?.id)

    socket.emitMessage({
      type: "res",
      id: connectId,
      ok: true,
      payload: { protocol: 3 },
    })

    const chatFrame = await waitForFrame(factory, 0, 1)
    const chatId = String(chatFrame?.id)

    socket.emitMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-other",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "ignore me early" }] },
      },
    })

    socket.emitMessage({
      type: "res",
      id: chatId,
      ok: true,
      payload: { runId: "run-target", status: "started" },
    })

    socket.emitMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-other",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "ignore me" }] },
      },
    })

    socket.emitMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-target",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "use me" }] },
      },
    })

    await expect(request).resolves.toMatchObject({
      text: "use me",
    })
  })

  it("retries when socket closes before completion", async () => {
    const factory = new MockGatewaySocketFactory()
    const request = chatWithGateway({
      gatewayUrl: "ws://gateway.example.com",
      gatewayToken: "gateway-token",
      text: "ping",
      socketFactory: factory.create,
      maxRetryAttempts: 2,
      reconnectDelaysMs: [0],
    })

    const firstConnect = await waitForFrame(factory, 0, 0)
    const firstSocket = factory.sockets[0]
    const firstConnectId = String(firstConnect?.id)
    firstSocket.emitMessage({
      type: "res",
      id: firstConnectId,
      ok: true,
      payload: { protocol: 3 },
    })
    const firstChat = await waitForFrame(factory, 0, 1)
    const firstChatId = String(firstChat?.id)
    firstSocket.emitMessage({
      type: "res",
      id: firstChatId,
      ok: true,
      payload: { runId: "run-1", status: "started" },
    })
    firstSocket.close()

    await vi.waitFor(() => {
      expect(factory.sockets.length).toBe(2)
    })

    const secondSocket = factory.sockets[1]
    const secondConnect = await waitForFrame(factory, 1, 0)
    const secondConnectId = String(secondConnect?.id)
    secondSocket.emitMessage({
      type: "res",
      id: secondConnectId,
      ok: true,
      payload: { protocol: 3 },
    })
    const secondChat = await waitForFrame(factory, 1, 1)
    const secondChatId = String(secondChat?.id)
    secondSocket.emitMessage({
      type: "res",
      id: secondChatId,
      ok: true,
      payload: { runId: "run-2", status: "started" },
    })
    secondSocket.emitMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-2",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "recovered" }],
        },
      },
    })

    await expect(request).resolves.toMatchObject({
      text: "recovered",
    })
  })
})
