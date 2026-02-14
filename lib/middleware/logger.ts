export type LoggerLevel = "debug" | "info" | "warn" | "error"

type LoggerFactoryOptions = {
  level?: LoggerLevel
}

type LoggerOutput = {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

const LEVEL_VALUES: Record<LoggerLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const format = (level: LoggerLevel, message: string) => {
  const date = new Date().toISOString()
  return `[${date}] [${level.toUpperCase()}] ${message}`
}

function shouldEmit(level: LoggerLevel, minLevel: LoggerLevel) {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[minLevel]
}

export function createLogger(options: LoggerFactoryOptions = {}): LoggerOutput {
  const minimum = options.level ?? "info"

  return {
    debug: (...args: unknown[]) => {
      if (shouldEmit("debug", minimum)) {
        console.log(format("debug", String(args[0])))
      }
    },
    info: (...args: unknown[]) => {
      if (shouldEmit("info", minimum)) {
        console.info(format("info", String(args[0])))
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldEmit("warn", minimum)) {
        console.warn(format("warn", String(args[0])))
      }
    },
    error: (...args: unknown[]) => {
      if (shouldEmit("error", minimum)) {
        console.error(format("error", String(args[0])))
      }
    },
  }
}
