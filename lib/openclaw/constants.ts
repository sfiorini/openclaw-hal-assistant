export const GATEWAY_DEFAULT_TIMEOUT_MS = 120_000
export const GATEWAY_DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 4000] as const
export const GATEWAY_DEFAULT_MAX_RETRY_ATTEMPTS = 3
export const GATEWAY_MAX_RECONNECT_DELAY_MS = 30_000

export const resolveGatewayReconnectDelayMs = (
  attempt: number,
  delays: ReadonlyArray<number> = GATEWAY_DEFAULT_RECONNECT_DELAYS_MS
): number => {
  const safeAttempt = Math.max(attempt, 0)
  if (safeAttempt >= delays.length) {
    return GATEWAY_MAX_RECONNECT_DELAY_MS
  }
  return delays[safeAttempt]
}
