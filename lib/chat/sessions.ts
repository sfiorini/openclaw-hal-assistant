import { createLogger } from "../middleware/logger"
import { buildSessionIdentity } from "./session-id"

const logger = createLogger()

export const SESSION_CONFIG = {
  maxAgeMs: 30 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
  maxConversationLength: 50,
  maxConcurrentSessions: 1000,
  maxConcurrentJobsPerSession: 1,
} as const

export type SessionMessage = {
  role: "user" | "assistant"
  content: string
}

export type ChatSession = {
  id: string
  sessionName: string
  sessionKey: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  conversation: SessionMessage[]
  activeJobCount: number
  modelInitialized: boolean
}

type SessionCreationOptions = {
  appName?: string
  gatewayUsername?: string
  requestedSessionId?: string
  forceRequestedSessionId?: boolean
}

type SessionStoreEvent = {
  event:
    | "session_created"
    | "session_reset"
    | "session_appended"
    | "session_job_count_changed"
    | "session_cleaned"
  id: string
  reason?: string
}

const sessionStore = new Map<string, ChatSession>()
const sessionLocks = new Map<string, Promise<unknown>>()

let cleanupStarted = false
const nowIso = () => new Date().toISOString()
const nowMs = () => Date.now()
const clone = <T>(value: T): T => structuredClone(value)

const emitSessionEvent = (payload: SessionStoreEvent) => {
  logger.info(
    JSON.stringify({
      event: payload.event,
      sessionId: payload.id,
      reason: payload.reason,
    })
  )
}

const serializeDate = (value: number) => new Date(value).toISOString()
const isExpired = (expiresAt: string, now = nowMs()) => new Date(expiresAt).getTime() <= now

const normalizeMessage = (value: { role: "user" | "assistant"; content: unknown }) => ({
  role: value.role,
  content: String(value.content).trim(),
})

const normalizeConversation = (conversation: Array<{ role: "user" | "assistant"; content: string }>) =>
  conversation
    .filter((item) => item && typeof item.content === "string" && item.content.trim().length > 0)
    .map((item) => normalizeMessage(item as { role: "user" | "assistant"; content: unknown }))
    .slice(-SESSION_CONFIG.maxConversationLength)

const withSessionLock = async <T>(sessionId: string, task: () => T | Promise<T>): Promise<T> => {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve()
  const next = previous.then(() => task())
  const done = next.then(() => undefined, () => undefined)
  sessionLocks.set(sessionId, done)

  try {
    return await next
  } finally {
    if (sessionLocks.get(sessionId) === done) {
      sessionLocks.delete(sessionId)
    }
  }
}

const createSession = (
  conversation: SessionMessage[] = [],
  options: Omit<SessionCreationOptions, "forceRequestedSessionId"> = {}
): ChatSession => {
  if (sessionStore.size >= SESSION_CONFIG.maxConcurrentSessions) {
    const error = {
      code: "session_limit_exceeded",
      message: "Session capacity exceeded",
    }
    throw error
  }

  const now = nowMs()
  const identity = buildSessionIdentity({
    appName: options.appName,
    username: options.gatewayUsername,
    sessionId: options.requestedSessionId,
  })
  const sessionName = identity.sessionKey

  const createdAt = nowIso()
  return {
    id: identity.sessionId,
    sessionName,
    sessionKey: identity.sessionKey,
    createdAt,
    updatedAt: createdAt,
    expiresAt: serializeDate(now + SESSION_CONFIG.maxAgeMs),
    conversation: normalizeConversation(conversation),
    activeJobCount: 0,
    modelInitialized: false,
  }
}

const pruneExpired = (now = nowMs()) => {
  let count = 0
  for (const [id, session] of sessionStore.entries()) {
    if (isExpired(session.expiresAt, now)) {
      sessionStore.delete(id)
      count += 1
      emitSessionEvent({ event: "session_cleaned", id })
    }
  }

  if (count > 0) {
    logger.info(`session cleanup removed ${count} sessions`)
  }
}

const ensureSessionCleanup = () => {
  if (cleanupStarted) {
    return
  }

  const interval = setInterval(() => {
    pruneExpired()
  }, SESSION_CONFIG.cleanupIntervalMs)
  interval.unref?.()
  cleanupStarted = true
}

export const __resetChatSessionsForTests = () => {
  sessionStore.clear()
  sessionLocks.clear()
  cleanupStarted = false
}

export const __setSessionExpirationForTesting = (sessionId: string, expiresAt: string) => {
  const existing = sessionStore.get(sessionId)
  if (!existing) {
    return
  }
  sessionStore.set(sessionId, {
    ...existing,
    expiresAt,
  })
}

export const __runSessionCleanupForTests = () => {
  pruneExpired()
}

export const getChatSession = (sessionId: string): ChatSession | undefined => {
  const session = sessionStore.get(sessionId)
  if (!session || isExpired(session.expiresAt)) {
    return undefined
  }
  return clone(session)
}

export const getSessionConversation = (sessionId: string): SessionMessage[] => {
  const session = getChatSession(sessionId)
  return session ? clone(session.conversation) : []
}

export const getOrCreateSession = async (
  requestedSessionId?: string,
  createNew = false,
  incomingConversation: SessionMessage[] = [],
  options: SessionCreationOptions = {}
): Promise<ChatSession> => {
  ensureSessionCleanup()
  const effectiveSessionId = requestedSessionId ?? options.requestedSessionId

  if (!createNew) {
    if (effectiveSessionId) {
      const existing = getChatSession(effectiveSessionId)
      if (existing) {
        return existing
      }
      if (options.forceRequestedSessionId) {
        const seededSession = createSession(
          createNew ? [] : incomingConversation,
          {
            ...options,
            requestedSessionId: effectiveSessionId,
          }
        )
        sessionStore.set(seededSession.id, seededSession)
        emitSessionEvent({ event: "session_created", id: seededSession.id })
        return clone(seededSession)
      }
    }
  }

  const conversationSeed =
    createNew || incomingConversation.length === 0 ? [] : incomingConversation
  const session = createSession(conversationSeed, {
    ...options,
    requestedSessionId: options.forceRequestedSessionId ? effectiveSessionId : undefined,
  })
  sessionStore.set(session.id, session)
  emitSessionEvent({ event: "session_created", id: session.id })
  return clone(session)
}

export const resetChatSession = async (sessionId: string) => {
  return withSessionLock(sessionId, () => {
    const existing = getChatSession(sessionId)
    if (!existing) {
      const error = {
        code: "session_not_found",
        message: "Session does not exist",
      }
      throw error
    }

    const reset = {
      ...existing,
      conversation: [],
      modelInitialized: false,
      updatedAt: nowIso(),
      expiresAt: serializeDate(nowMs() + SESSION_CONFIG.maxAgeMs),
    }
    sessionStore.set(existing.id, reset)
    emitSessionEvent({ event: "session_reset", id: existing.id })
    return clone(reset)
  })
}

export const appendToSessionConversation = async (
  sessionId: string,
  entries: SessionMessage[]
) => {
  return withSessionLock(sessionId, () => {
    const existing = getChatSession(sessionId)
    if (!existing) {
      const error = {
        code: "session_not_found",
        message: "Session does not exist",
      }
      throw error
    }

    const next = {
      ...existing,
      conversation: normalizeConversation(existing.conversation.concat(entries)),
      updatedAt: nowIso(),
      expiresAt: serializeDate(nowMs() + SESSION_CONFIG.maxAgeMs),
    }
    sessionStore.set(existing.id, next)
    emitSessionEvent({ event: "session_appended", id: existing.id })
    return clone(next)
  })
}

export const getSessionForJobLimitCheck = async (sessionId: string): Promise<ChatSession> => {
  return withSessionLock(sessionId, () => {
    const existing = getChatSession(sessionId)
    if (!existing) {
      const error = {
        code: "session_not_found",
        message: "Session does not exist",
      }
      throw error
    }

    if (existing.activeJobCount >= SESSION_CONFIG.maxConcurrentJobsPerSession) {
      const error = {
        code: "concurrency_error",
        message: "Maximum concurrent jobs for this session exceeded",
      }
      throw error
    }

    const next = {
      ...existing,
      activeJobCount: existing.activeJobCount + 1,
      updatedAt: nowIso(),
      expiresAt: serializeDate(nowMs() + SESSION_CONFIG.maxAgeMs),
    }
    sessionStore.set(existing.id, next)
    emitSessionEvent({ event: "session_job_count_changed", id: existing.id })
    return clone(next)
  })
}

export const releaseSessionJobSlot = async (sessionId: string) => {
  return withSessionLock(sessionId, () => {
    const existing = getChatSession(sessionId)
    if (!existing) {
      return
    }

    const next = {
      ...existing,
      activeJobCount: Math.max(0, existing.activeJobCount - 1),
      updatedAt: nowIso(),
      expiresAt: serializeDate(nowMs() + SESSION_CONFIG.maxAgeMs),
    }
    sessionStore.set(existing.id, next)
    emitSessionEvent({ event: "session_job_count_changed", id: existing.id })
    return clone(next)
  })
}

export const setSessionModelInitialized = async (sessionId: string) => {
  return withSessionLock(sessionId, () => {
    const existing = getChatSession(sessionId)
    if (!existing) {
      return
    }

    const next = {
      ...existing,
      modelInitialized: true,
      updatedAt: nowIso(),
      expiresAt: serializeDate(nowMs() + SESSION_CONFIG.maxAgeMs),
    }
    sessionStore.set(existing.id, next)
    return clone(next)
  })
}
