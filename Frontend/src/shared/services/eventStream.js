import { createApiError } from '../errors/apiError.js'
import { notifyStreamAuthorizationLost } from '../errors/unauthorizedSession.js'
import { API_BASE_URL } from './apiClient.js'

const LIVE_STABILITY_WINDOW_MS = 5000
const MAX_RETRY_AFTER_MS = 30000
const EXPECTED_RECONNECT_DELAY_MS = 250
const TERMINAL_AUTH_EVENTS = new Map([
  ['stream.auth_expired', { code: 'SSE_AUTH_EXPIRED', message: 'Your session has expired.' }],
  ['stream.auth_revoked', { code: 'SSE_AUTH_REVOKED', message: 'Your session is no longer authorized.' }],
])

function parseRetryAfter(value) {
  if (!value) return 0
  const seconds = Number(value)

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  }

  const retryAt = Date.parse(value)
  if (Number.isNaN(retryAt)) return 0
  return Math.min(Math.max(0, retryAt - Date.now()), MAX_RETRY_AFTER_MS)
}

function parseSseMessage(message) {
  const lines = message.replaceAll('\r\n', '\n').split('\n')
  let type = 'message'
  const dataLines = []

  lines.forEach((line) => {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim()
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  })

  if (dataLines.length === 0) return null

  return {
    type,
    payload: JSON.parse(dataLines.join('\n')),
  }
}

export function subscribeToServerEvents(path, token, {
  onEvent,
  onError,
  onFallback,
  onRecovery,
  onStatusChange,
} = {}) {
  const controller = new AbortController()
  let isClosed = false
  let retryCount = 0
  let retryTimer = null
  let fallbackStarted = false
  let activeReader = null
  let stabilityTimer = null
  let lastStatus = null
  let retryAfterMs = 0

  function updateStatus(status) {
    if (lastStatus === status) return
    lastStatus = status
    onStatusChange?.(status)
  }

  function confirmLive() {
    const isRecovering = retryCount > 0 || fallbackStarted
    retryCount = 0
    fallbackStarted = false
    updateStatus('live')
    if (isRecovering) onRecovery?.()
  }

  function clearStabilityTimer() {
    if (!stabilityTimer) return
    window.clearTimeout(stabilityTimer)
    stabilityTimer = null
  }

  function scheduleLiveConfirmation(reader) {
    if (stabilityTimer) return
    stabilityTimer = window.setTimeout(() => {
      stabilityTimer = null
      if (!isClosed && activeReader === reader) confirmLive()
    }, LIVE_STABILITY_WINDOW_MS)
  }

  async function releaseActiveReader({ cancel = false } = {}) {
    const reader = activeReader
    activeReader = null
    clearStabilityTimer()
    if (!reader) return

    if (cancel) {
      try {
        await reader.cancel()
      } catch {
        // Retry handling continues even when the stream cannot be cancelled cleanly.
      }
    }

    try {
      reader.releaseLock()
    } catch {
      // Some stream implementations release the lock automatically.
    }
  }

  async function connect() {
    retryTimer = null
    if (retryCount === 0 && lastStatus !== 'live') updateStatus('connecting')

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const error = createApiError('Unable to connect to event stream.', response.status)
        error.retryAfterMs = response.status === 429
          ? parseRetryAfter(response.headers.get('retry-after'))
          : 0
        throw error
      }

      const reader = response.body.getReader()
      activeReader = reader
      const decoder = new TextDecoder()
      let buffer = ''

      while (!isClosed) {
        const { done, value } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })
        let boundaryIndex = buffer.indexOf('\n\n')

        while (boundaryIndex >= 0) {
          const rawMessage = buffer.slice(0, boundaryIndex).trim()
          buffer = buffer.slice(boundaryIndex + 2)

          if (rawMessage) {
            const event = parseSseMessage(rawMessage)
            if (event) {
              const terminalAuth = TERMINAL_AUTH_EVENTS.get(event.type)
              if (terminalAuth) {
                const error = createApiError(terminalAuth.message, 401, event.payload, terminalAuth.code)
                error.isTerminalStreamAuthorization = true
                throw error
              }

              if (event.type === 'stream.reconnect') {
                const error = createApiError('The event stream requested a reconnect.', 0, event.payload, 'SSE_RECONNECT')
                error.isExpectedReconnect = true
                throw error
              }

              onEvent?.(event)
              scheduleLiveConfirmation(reader)
            }
          }

          boundaryIndex = buffer.indexOf('\n\n')
        }
      }

      if (!isClosed) {
        const error = createApiError('Event stream disconnected.', 0)
        throw error
      }
    } catch (error) {
      await releaseActiveReader({ cancel: true })
      if (isClosed || error.name === 'AbortError') return

      if (error.status === 401 || error.status === 403 || error.isTerminalStreamAuthorization) {
        onError?.(error)
        notifyStreamAuthorizationLost(error, { token, path })
        updateStatus('unauthorized')
        return
      }

      if (!error.isExpectedReconnect) {
        retryCount += 1
        onError?.(error)
      }

      retryAfterMs = error.status === 429 ? error.retryAfterMs || 0 : 0

      if (error.isExpectedReconnect) {
        updateStatus('reconnecting')
      } else if (error.status === 429) {
        updateStatus('reconnecting')
      } else if (retryCount >= 3 && !fallbackStarted) {
        fallbackStarted = true
        updateStatus('degraded')
        onFallback?.()
      } else if (!fallbackStarted) {
        updateStatus('reconnecting')
      }

      const retryDelay = error.isExpectedReconnect
        ? EXPECTED_RECONNECT_DELAY_MS
        : Math.max(Math.min(1000 * 2 ** retryCount, 10000), retryAfterMs)
      retryTimer = window.setTimeout(connect, retryDelay)
    }
  }

  connect()

  return () => {
    isClosed = true
    controller.abort()
    clearStabilityTimer()
    releaseActiveReader({ cancel: true })

    if (retryTimer) {
      window.clearTimeout(retryTimer)
    }
  }
}
