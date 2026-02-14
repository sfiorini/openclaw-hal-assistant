export type TimeoutFunction<T> = (signal: AbortSignal) => Promise<T>

const formatTimeoutError = (ms: number) => `Operation timed out after ${ms}ms`

export function createTimeoutError(timeoutMs: number) {
  return new DOMException(formatTimeoutError(timeoutMs), "TimeoutError")
}

export async function withTimeout<T>(
  task: TimeoutFunction<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  const timeoutError = createTimeoutError(timeoutMs)

  const timeout = setTimeout(() => {
    controller.abort(timeoutError)
  }, timeoutMs)

  const timeoutPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(controller.signal.reason as Error)
    }, { once: true })
  })

  try {
    return await Promise.race([task(controller.signal), timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError"
}
