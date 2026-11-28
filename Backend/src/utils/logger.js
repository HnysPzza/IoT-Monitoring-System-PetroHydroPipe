const { getRequestId } = require('../shared/requestContext')

// ponytail: stdlib JSON logger; swap to pino if log volume or redaction rules grow.
const RESERVED_KEYS = new Set(['ts', 'level', 'requestId', 'msg'])

function replaceValue(_key, value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.code ? { code: value.code } : {}),
      stack: value.stack,
    }
  }
  if (typeof value === 'bigint') return value.toString()
  return value
}

function safeStringify(entry) {
  try {
    return JSON.stringify(entry, replaceValue)
  } catch {
    const seen = new WeakSet()
    try {
      return JSON.stringify(entry, (key, value) => {
        const normalized = replaceValue(key, value)
        if (normalized && typeof normalized === 'object') {
          if (seen.has(normalized)) return '[Circular]'
          seen.add(normalized)
        }
        return normalized
      })
    } catch (error) {
      return JSON.stringify({
        ts: entry.ts,
        level: entry.level,
        ...(entry.requestId ? { requestId: entry.requestId } : {}),
        msg: String(entry.msg),
        serializationError: error?.message || String(error),
      })
    }
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function buildEntry(level, message, args) {
  const requestId = getRequestId()
  const isPlainMeta = args.length === 1 && isPlainObject(args[0])

  const entry = {
    ts: new Date().toISOString(),
    level,
    ...(requestId ? { requestId } : {}),
    msg: message instanceof Error ? message.message : String(message),
  }

  if (message instanceof Error) entry.error = message
  if (isPlainMeta) {
    for (const [key, value] of Object.entries(args[0])) {
      if (RESERVED_KEYS.has(key)) continue
      entry[key] = value
    }
  } else if (args.length > 0) {
    entry.details = args.length === 1 ? args[0] : args
  }

  return entry
}

const logger = {
  info(message, ...args) {
    console.log(safeStringify(buildEntry('info', message, args)))
  },
  warn(message, ...args) {
    console.warn(safeStringify(buildEntry('warn', message, args)))
  },
  error(message, ...args) {
    console.error(safeStringify(buildEntry('error', message, args)))
  },
}

module.exports = logger
