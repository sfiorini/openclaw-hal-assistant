const DEFAULT_APP_NAME = "openclaw-hal-assistant"
const DEFAULT_GATEWAY_USERNAME = "default-user"

type SessionIdentityInput = {
  appName?: string
  username?: string
  sessionId?: string
}

type SessionIdentity = {
  sessionId: string
  sessionKey: string
}

const normalize = (value: string | undefined, fallback: string) =>
  value?.trim().length ? value!.trim() : fallback

export const buildSessionIdentity = ({
  appName,
  username,
  sessionId,
}: SessionIdentityInput): SessionIdentity => {
  const resolvedSessionId = sessionId ?? crypto.randomUUID()
  const resolvedAppName = normalize(appName, DEFAULT_APP_NAME)
  const resolvedUsername = normalize(username, DEFAULT_GATEWAY_USERNAME)

  return {
    sessionId: resolvedSessionId,
    sessionKey: `app:${resolvedAppName}:user:${resolvedUsername}:uuid:${resolvedSessionId}`,
  }
}

export const buildSessionName = (input: SessionIdentityInput) => {
  const identity = buildSessionIdentity(input)
  return identity.sessionKey
}

export const sessionDefaults = {
  appName: DEFAULT_APP_NAME,
  gatewayUsername: DEFAULT_GATEWAY_USERNAME,
} as const
