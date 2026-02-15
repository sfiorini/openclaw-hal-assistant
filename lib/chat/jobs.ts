import { createLogger } from "../middleware/logger"

type ChatJobProgress =
  | "accepted"
  | "dispatching_to_openclaw"
  | "waiting_for_upstream"
  | "tool_execution"
  | "finalizing"
  | "awaiting_client_poll"
  | "cancel_pending"

export type ChatJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type ChatJobErrorCode =
  | "validation_error"
  | "idempotency_conflict"
  | "upstream_error"
  | "tool_error"
  | "cancelled"
  | "timeout"
  | "concurrency_error"
  | "server_error"

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type ChatJobError = {
  code: ChatJobErrorCode
  message: string
  details?: Record<string, unknown>
}

export type ChatJobResponse = {
  text: string
  conversationHistory: ChatMessage[]
}

export type ChatJob = {
  id: string
  status: ChatJobStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  expiresAt: string
  request: {
    message: string
    conversationHistory: ChatMessage[]
    idempotencyKey?: string
  }
  response?: ChatJobResponse
  error?: ChatJobError
  progress?: ChatJobProgress
  pollAfterMs?: number
  attemptCount?: number
}

type ChatJobInput = {
  message: string
  conversationHistory: ChatMessage[]
  idempotencyKey?: string
}

type PollResponse = {
  jobId: string
  status: ChatJobStatus
  pollAfterMs: number
  attemptCount: number
  progress?: ChatJobProgress
  startedAt?: string
  finishedAt?: string
  response?: ChatJobResponse
  error?: ChatJobError
}

type JobLifecycleEvent = "chat_job_created" | "chat_job_started" | "chat_job_completed" | "chat_job_failed" | "chat_job_cleaned" | "chat_job_cancelled"

type IdempotencyRecord = {
  jobId: string
  expiresAt: number
}

export const JOB_CONFIG = {
  maxConcurrentJobs: 100,
  maxJobAgeMs: 5 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
  maxRetriesForCollision: 8,
  idempotencyKeyWindowMs: 5 * 60 * 1000,
} as const

export const POLL_CONFIG = {
  initialPollAfterMs: 500,
  maxPollAttempts: 240,
  basePollIntervalMs: 1000,
  pollBackoffMultiplier: 1.05,
  maxPollIntervalMs: 5000,
  maxWaitMs: 240000,
} as const

type JobLogger = {
  event: JobLifecycleEvent
  jobId: string
  status?: ChatJobStatus
  requestId?: string
  durationMs?: number
  reason?: string
}

const logger = createLogger()
const jobStore = new Map<string, ChatJob>()
const idempotencyStore = new Map<string, IdempotencyRecord>()

let startedCleanupWorker = false

const nowIso = () => new Date().toISOString()
const nowMs = () => Date.now()
const clone = <T,>(value: T): T => structuredClone(value)

const emitEvent = (payload: JobLogger) => {
  logger.info(
    JSON.stringify({
      event: payload.event,
      jobId: payload.jobId,
      status: payload.status,
      requestId: payload.requestId,
      durationMs: payload.durationMs,
      reason: payload.reason,
    })
  )
}

const serializeDate = (value: number) => new Date(value).toISOString()

const normalizeConversationHistory = (value: ChatMessage[]) =>
  value.slice(0, 20).map((item) => ({
    role: item.role,
    content: String(item.content).trim(),
  }))

const normalizeText = (value: string) => value.trim()

const isExpired = (expiresAt: string, now: number) => new Date(expiresAt).getTime() <= now

const buildPollAfterMs = (status: ChatJobStatus, attemptCount = 0) => {
  if (status === "queued" || status === "running") {
    if (status === "queued" && attemptCount <= 0) {
      return POLL_CONFIG.initialPollAfterMs
    }

    const exponentialDelay = POLL_CONFIG.basePollIntervalMs * POLL_CONFIG.pollBackoffMultiplier ** attemptCount
    const cappedDelay = Math.min(Math.round(exponentialDelay), POLL_CONFIG.maxPollIntervalMs)
    return status === "queued" ? Math.max(POLL_CONFIG.basePollIntervalMs, cappedDelay) : cappedDelay
  }

  return 0
}

const applyUpdate = (
  job: ChatJob,
  update: Partial<ChatJob>,
  requestId?: string
): ChatJob => {
  const previousStatus = job.status
  const updatedAt = nowIso()
  const next = {
    ...job,
    ...update,
    updatedAt,
  }

  if (update.status && update.status !== previousStatus) {
    switch (update.status) {
      case "running":
        if (!job.startedAt) {
          next.startedAt = nowIso()
        }
        break
      case "completed":
      case "failed":
      case "cancelled":
        next.finishedAt = nowIso()
        break
    }
  }

  return next
}

const createStoreEvent = (job: ChatJob, event: JobLogger["event"], requestId?: string) => {
  emitEvent({
    event,
    jobId: job.id,
    status: job.status,
    requestId,
    durationMs: job.finishedAt
      ? new Date(job.finishedAt).getTime() - new Date(job.createdAt).getTime()
      : undefined,
    reason: job.error?.message,
  })
}

const countActive = () =>
  Array.from(jobStore.values()).filter((job) =>
    ["queued", "running"].includes(job.status)
  ).length

const pruneIdempotency = (now: number) => {
  for (const [idempotencyKey, record] of idempotencyStore.entries()) {
    if (record.expiresAt <= now) {
      idempotencyStore.delete(idempotencyKey)
    }
  }
}

const getCollisionSafeId = () => {
  let attempts = 0
  while (attempts < JOB_CONFIG.maxRetriesForCollision) {
    const id = crypto.randomUUID()
    if (!jobStore.has(id)) {
      return id
    }
    attempts += 1
  }

  throw new Error("Unable to allocate job id after retries")
}

const createExpiry = (createdMs: number) => serializeDate(createdMs + JOB_CONFIG.maxJobAgeMs)

const calculatePollAfterMs = (status: ChatJobStatus, attemptCount = 0) =>
  buildPollAfterMs(status, attemptCount)

const cleanupExpiredJobs = () => {
  const currentTime = nowMs()
  let removedCount = 0

  for (const [jobId, job] of jobStore.entries()) {
    if (isExpired(job.expiresAt, currentTime)) {
      jobStore.delete(jobId)
      removedCount += 1
      createStoreEvent(job, "chat_job_cleaned")
    }
  }

  pruneIdempotency(currentTime)

  if (removedCount > 0) {
    logger.info(`chat job cleanup removed ${removedCount}`)
  }
}

const ensureCleanupWorker = () => {
  if (startedCleanupWorker) {
    return
  }

  const handle = setInterval(cleanupExpiredJobs, JOB_CONFIG.cleanupIntervalMs)
  handle.unref?.()
  startedCleanupWorker = true
}

export const __resetChatJobsForTests = () => {
  jobStore.clear()
  idempotencyStore.clear()
}

export const __setJobExpirationForTesting = (jobId: string, expiresAt: string) => {
  const existing = jobStore.get(jobId)
  if (!existing) {
    return
  }
  jobStore.set(jobId, {
    ...existing,
    expiresAt,
  })
}

export const __runCleanupForTests = () => {
  cleanupExpiredJobs()
}

export const __setIdempotencyStoreForTesting = (key: string, record: IdempotencyRecord) => {
  idempotencyStore.set(key, record)
}

export const getChatJobById = (id: string): ChatJob | undefined => {
  const job = jobStore.get(id)
  return job ? clone(job) : undefined
}

export const listChatJobs = (limit = 20): ChatJob[] => {
  return Array.from(jobStore.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((job) => clone(job))
}

export const createChatJob = (input: ChatJobInput): ChatJob => {
  ensureCleanupWorker()
  const now = nowMs()
  pruneIdempotency(now)

  if (input.idempotencyKey) {
    const existing = idempotencyStore.get(input.idempotencyKey)
    if (existing && existing.expiresAt > now) {
      const existingJob = jobStore.get(existing.jobId)
      if (existingJob) {
        return clone(existingJob)
      }
      idempotencyStore.delete(input.idempotencyKey)
    }
  }

  if (countActive() >= JOB_CONFIG.maxConcurrentJobs) {
    const error = {
      code: "concurrency_error" as const,
      message: "Maximum concurrent jobs exceeded",
    }
    throw error
  }

  const id = getCollisionSafeId()
  const normalizedMessage = normalizeText(input.message)
  const normalizedHistory = normalizeConversationHistory(input.conversationHistory)
  const createdAt = nowIso()

  const job: ChatJob = {
    id,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    attemptCount: 0,
    expiresAt: createExpiry(now),
    request: {
      message: normalizedMessage,
      conversationHistory: normalizedHistory,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    },
    progress: "accepted",
  }

  jobStore.set(id, job)
  if (input.idempotencyKey) {
    idempotencyStore.set(input.idempotencyKey, {
      jobId: job.id,
      expiresAt: now + JOB_CONFIG.idempotencyKeyWindowMs,
    })
  }

  createStoreEvent(job, "chat_job_created")
  return clone(job)
}

export const markChatJobRunning = (id: string, requestId?: string): ChatJob | undefined => {
  const current = jobStore.get(id)
  if (!current || current.status === "cancelled") {
    return undefined
  }
  if (!["queued", "running"].includes(current.status)) {
    return undefined
  }

  const updated = applyUpdate(
    current,
    {
      status: "running",
      progress: "dispatching_to_openclaw",
      pollAfterMs: calculatePollAfterMs("running", current.attemptCount ?? 0),
    },
    requestId
  )

  jobStore.set(id, updated)
  createStoreEvent(updated, "chat_job_started", requestId)
  return clone(updated)
}

export const markChatJobFinalized = (
  id: string,
  status: "completed" | "failed" | "cancelled",
  payload: { response?: ChatJobResponse; error?: ChatJobError },
  requestId?: string
): ChatJob | undefined => {
  const current = jobStore.get(id)
  if (!current) {
    return undefined
  }

  if (current.status === status) {
    return clone(current)
  }

  const updated = applyUpdate(
    current,
    {
      status,
      progress: status === "cancelled" ? "cancel_pending" : "finalizing",
      response: payload.response,
      error: payload.error,
      pollAfterMs: 0,
    },
    requestId
  )
  jobStore.set(id, updated)

  if (status === "completed") {
    createStoreEvent(updated, "chat_job_completed", requestId)
  } else if (status === "failed") {
    createStoreEvent(updated, "chat_job_failed", requestId)
  } else {
    createStoreEvent(updated, "chat_job_cancelled", requestId)
  }

  return clone(updated)
}

export const markChatJobProgress = (id: string, progress: ChatJobProgress): void => {
  const current = jobStore.get(id)
  if (!current || ["completed", "failed", "cancelled"].includes(current.status)) {
    return
  }

  jobStore.set(id, {
    ...current,
    progress,
    updatedAt: nowIso(),
  })
}

export const setChatJobPollProgress = (id: string): PollResponse | undefined => {
  const current = jobStore.get(id)
  if (!current) {
    return undefined
  }

  if (["completed", "failed", "cancelled"].includes(current.status)) {
    return {
      jobId: current.id,
      status: current.status,
      pollAfterMs: 0,
      attemptCount: current.attemptCount ?? 0,
      progress: current.progress,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      response: current.response,
      error: current.error,
    }
  }

  const attemptCount = (current.attemptCount ?? 0) + 1
  const updated = {
    ...current,
    attemptCount,
    pollAfterMs: calculatePollAfterMs(current.status, attemptCount),
    updatedAt: nowIso(),
  }
  jobStore.set(id, updated)

  return {
    jobId: updated.id,
    status: updated.status,
    pollAfterMs: updated.pollAfterMs,
    attemptCount,
    progress: updated.progress,
    startedAt: updated.startedAt,
    finishedAt: updated.finishedAt,
    response: updated.response,
    error: updated.error,
  }
}

export const cancelChatJob = (id: string): ChatJob | undefined => {
  const current = jobStore.get(id)
  if (!current || current.status === "completed" || current.status === "failed") {
    return undefined
  }

  const updated = applyUpdate(current, {
    status: "cancelled",
    progress: "cancel_pending",
    error: {
      code: "cancelled",
      message: "Job cancelled",
    },
    pollAfterMs: 0,
  })

  jobStore.set(id, updated)
  createStoreEvent(updated, "chat_job_cancelled")
  return clone(updated)
}

export const readChatJobForPolling = (id: string): PollResponse | undefined => {
  return setChatJobPollProgress(id)
}

export const getPollAfterMs = (status: ChatJobStatus, attemptCount = 0) =>
  calculatePollAfterMs(status, attemptCount)
