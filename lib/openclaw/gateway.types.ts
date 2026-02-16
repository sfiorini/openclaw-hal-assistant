export type GatewayErrorCode =
  | "connection"
  | "protocol"
  | "timeout"
  | "upstream"
  | "incomplete_stream"
  | "challenge_auth_failed"

export interface GatewaySocketLike {
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: MessageEvent | Event) => void
  ): void
  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: MessageEvent | Event) => void
  ): void
  close(code?: number, reason?: string): void
  send(data: string): void
}

export type GatewaySocketFactory = (url: string) => GatewaySocketLike

export interface GatewayChatInput {
  gatewayUrl: string
  gatewayToken: string
  deviceId?: string
  conversationId?: string
  text: string
  metadata?: Record<string, unknown>
  timeoutMs?: number
  maxRetryAttempts?: number
  reconnectDelaysMs?: ReadonlyArray<number>
  socketFactory?: GatewaySocketFactory
}

export interface GatewayChatResult {
  text: string
  conversationId: string
  partialText?: string
}

export interface GatewayClientErrorOptions {
  code: GatewayErrorCode
  details?: Record<string, unknown>
  partialText?: string
  retryable?: boolean
  cause?: unknown
}

export class GatewayClientError extends Error {
  public code: GatewayErrorCode
  public details?: Record<string, unknown>
  public partialText?: string
  public retryable: boolean

  constructor(message: string, options: GatewayClientErrorOptions) {
    super(message)
    this.name = "GatewayClientError"
    this.code = options.code
    this.details = options.details
    this.partialText = options.partialText
    this.retryable = options.retryable ?? false
    if (options.cause) {
      this.cause = options.cause
    }
  }
}
