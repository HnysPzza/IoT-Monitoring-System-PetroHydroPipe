import { createApiError } from '../errors/apiError.js'
import { notifyStreamAuthorizationLost } from '../errors/unauthorizedSession.js'
import { API_BASE_URL } from './apiClient.js'
import { getSessionContext, refreshSessionOnce } from './sessionRefresh.js'

const LIVE_STABILITY_WINDOW_MS = 5000
const DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS = 75000
const MIN_STREAM_INACTIVITY_TIMEOUT_MS = 15000
const MAX_STREAM_INACTIVITY_TIMEOUT_MS = 300000
const STREAM_INACTIVITY_MULTIPLIER = 2.5
const MAX_RETRY_AFTER_MS = 30000
const EXPECTED_RECONNECT_DELAY_MS = 250
const EXPECTED_RECONNECT_JITTER_MS = 750
const MAX_RETRY_BASE_DELAY_MS = 10000
const RETRY_JITTER_RATIO = 0.25
const PLANNED_RECONNECT_REASONS = new Set([
  'max_lifetime',
  'server_shutdown',
])
const AUTHORIZATION_CHECK_FAILED_REASON = 'authorization_check_failed'
const AUTHORIZATION_VALIDATED_EVENT = 'stream.auth_validated'
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

function addJitter(baseDelayMs, jitterMs) {
  return baseDelayMs + (Math.random() * jitterMs)
}

function calculateRetryDelay({ isExpectedReconnect, retryCount, retryAfterMs }) {
  if (isExpectedReconnect) {
    return addJitter(EXPECTED_RECONNECT_DELAY_MS, EXPECTED_RECONNECT_JITTER_MS)
  }

  const baseDelayMs = Math.min(1000 * 2 ** retryCount, MAX_RETRY_BASE_DELAY_MS)
  const jitteredDelayMs = addJitter(baseDelayMs, baseDelayMs * RETRY_JITTER_RATIO)
  return Math.max(jitteredDelayMs, retryAfterMs)
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
  onOpen,
  onRecovery,
  onStatusChange,
} = {}) {
  const controller = new AbortController()
  const sessionContext = getSessionContext(token)
  // Held in a mutable binding so a silent session refresh can re-arm the
  // stream with the new access token without re-subscribing.
  let activeToken = token
  let isClosed = false
  let retryCount = 0
  let retryTimer = null
  let fallbackStarted = false
  let activeReader = null
  let stabilityTimer = null
  let inactivityTimer = null
  let lastStatus = null
  let retryAfterMs = 0
  let hasConnected = false
  let failedConnectionAttempts = 0
  let authorizationCheckFailureCount = 0
  let authorizationRecoveryActive = false
  let inactivityTimeoutMs = DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS
  let rateLimitFailureCount = 0
  const readerCancellationPromises = new WeakMap()
  const timedOutReaders = new WeakSet()

  function invokeHandler(handler, ...args) {
    try {
      const result = handler?.(...args)
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch {}
  }

  function updateStatus(status) {
    if (lastStatus === status) return
    lastStatus = status
    invokeHandler(onStatusChange, status)
  }

  function confirmLive() {
    if (authorizationRecoveryActive) return
    const isRecovering = retryCount > 0 || fallbackStarted
    retryCount = 0
    rateLimitFailureCount = 0
    fallbackStarted = false
    updateStatus('live')
    if (isRecovering) invokeHandler(onRecovery)
  }

  function confirmAuthorizationRecovery() {
    if (!authorizationRecoveryActive) return
    const isRecovering = retryCount > 0 || fallbackStarted
    authorizationRecoveryActive = false
    authorizationCheckFailureCount = 0
    retryCount = 0
    rateLimitFailureCount = 0
    fallbackStarted = false
    updateStatus('live')
    if (isRecovering) invokeHandler(onRecovery)
  }

  function clearStabilityTimer() {
    if (stabilityTimer === null) return
    window.clearTimeout(stabilityTimer)
    stabilityTimer = null
  }

  function scheduleLiveConfirmation(reader) {
    if (stabilityTimer !== null) return
    stabilityTimer = window.setTimeout(() => {
      stabilityTimer = null
      if (!isClosed && activeReader === reader) confirmLive()
    }, LIVE_STABILITY_WINDOW_MS)
  }

  function clearInactivityTimer() {
    if (inactivityTimer === null) return
    window.clearTimeout(inactivityTimer)
    inactivityTimer = null
  }

  function cancelReader(reader) {
    if (!reader) return Promise.resolve()
    const existingCancellation = readerCancellationPromises.get(reader)
    if (existingCancellation) return existingCancellation

    let cancellation
    try {
      cancellation = Promise.resolve(reader.cancel()).catch(() => {})
    } catch {
      cancellation = Promise.resolve()
    }
    readerCancellationPromises.set(reader, cancellation)
    return cancellation
  }

  function resetInactivityTimer(reader) {
    clearInactivityTimer()
    inactivityTimer = window.setTimeout(() => {
      inactivityTimer = null
      if (isClosed || activeReader !== reader) return
      timedOutReaders.add(reader)
      cancelReader(reader)
    }, inactivityTimeoutMs)
  }

  function alignInactivityTimeout(event) {
    if (event.type !== 'heartbeat') return
    const heartbeatIntervalMs = event.payload?.intervalMs
    if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) return

    inactivityTimeoutMs = Math.min(
      Math.max(heartbeatIntervalMs * STREAM_INACTIVITY_MULTIPLIER, MIN_STREAM_INACTIVITY_TIMEOUT_MS),
      MAX_STREAM_INACTIVITY_TIMEOUT_MS,
    )
  }

  function releaseActiveReader({ cancel = false } = {}) {
    const reader = activeReader
    activeReader = null
    clearStabilityTimer()
    clearInactivityTimer()
    if (!reader) return Promise.resolve()

    if (cancel) {
      cancelReader(reader)
    }

    try {
      reader.releaseLock()
    } catch {
      // Some stream implementations release the lock automatically.
    }

    return Promise.resolve()
  }

  async function connect() {
    retryTimer = null
    if (retryCount === 0 && lastStatus !== 'live') updateStatus('connecting')

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
        },
        signal: controller.signal,
      })

      if (isClosed) {
        try {
          await response.body?.cancel()
        } catch {
          // The subscription is already closed; transport cleanup is best effort.
        }
        return
      }

      if (!response.ok || !response.body) {
        const error = createApiError('Unable to connect to event stream.', response.status)
        error.retryAfterMs = response.status === 429
          ? parseRetryAfter(response.headers.get('retry-after'))
          : 0
        try {
          const cancellation = response.body?.cancel()
          if (cancellation && typeof cancellation.catch === 'function') cancellation.catch(() => {})
        } catch {
          // Retry handling continues even when an error response cannot be cancelled cleanly.
        }
        throw error
      }

      const reader = response.body.getReader()
      activeReader = reader
      resetInactivityTimer(reader)
      const openState = {
        isReconnect: hasConnected,
        isRetry: failedConnectionAttempts > 0,
      }
      hasConnected = true
      failedConnectionAttempts = 0

      invokeHandler(onOpen, openState)

      const decoder = new TextDecoder()
      let buffer = ''

      while (!isClosed) {
        const { done, value } = await reader.read()

        if (done) {
          if (timedOutReaders.has(reader)) {
            throw createApiError(
              'Event stream became inactive.',
              0,
              null,
              'SSE_INACTIVITY_TIMEOUT',
            )
          }
          break
        }

        resetInactivityTimer(reader)
        buffer += decoder.decode(value, { stream: true })
        let boundaryIndex = buffer.indexOf('\n\n')

        while (boundaryIndex >= 0) {
          const rawMessage = buffer.slice(0, boundaryIndex).trim()
          buffer = buffer.slice(boundaryIndex + 2)

          if (rawMessage) {
            const event = parseSseMessage(rawMessage)
            if (event) {
              alignInactivityTimeout(event)
              resetInactivityTimer(reader)
              const terminalAuth = TERMINAL_AUTH_EVENTS.get(event.type)
              if (terminalAuth) {
                const error = createApiError(terminalAuth.message, 401, event.payload, terminalAuth.code)
                error.isTerminalStreamAuthorization = true
                throw error
              }

              if (event.type === 'stream.reconnect') {
                const reconnectReason = event.payload?.reason
                const isAuthorizationCheckFailure = reconnectReason === AUTHORIZATION_CHECK_FAILED_REASON
                const error = createApiError(
                  isAuthorizationCheckFailure
                    ? 'The event stream authorization check failed.'
                    : 'The event stream requested a reconnect.',
                  0,
                  event.payload,
                  isAuthorizationCheckFailure ? 'SSE_AUTHORIZATION_CHECK_FAILED' : 'SSE_RECONNECT',
                )
                error.isExpectedReconnect = PLANNED_RECONNECT_REASONS.has(reconnectReason)
                error.isAuthorizationCheckFailure = isAuthorizationCheckFailure
                throw error
              }

              if (event.type === AUTHORIZATION_VALIDATED_EVENT) {
                confirmAuthorizationRecovery()
              } else {
                invokeHandler(onEvent, event)
              }
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
      if (activeReader && timedOutReaders.has(activeReader) && error.code !== 'SSE_INACTIVITY_TIMEOUT') {
        error = createApiError(
          'Event stream became inactive.',
          0,
          null,
          'SSE_INACTIVITY_TIMEOUT',
        )
      }
      await releaseActiveReader({ cancel: true })
      if (isClosed || error.name === 'AbortError') return

      if (!error.isExpectedReconnect) {
        failedConnectionAttempts += 1
      }

      if (error.status === 401 || error.isTerminalStreamAuthorization) {
        // The access token may have simply expired; one silent refresh revives
        // the stream without tearing down the whole session.
        let refreshedToken = null
        try {
          refreshedToken = await refreshSessionOnce(sessionContext)
        } catch {
          refreshedToken = null
        }

        if (refreshedToken && refreshedToken !== activeToken && !isClosed) {
          activeToken = refreshedToken
          retryCount = 0
          rateLimitFailureCount = 0
          fallbackStarted = false
          updateStatus('reconnecting')
          retryTimer = window.setTimeout(
            connect,
            addJitter(EXPECTED_RECONNECT_DELAY_MS, EXPECTED_RECONNECT_JITTER_MS),
          )
          return
        }

      }

      if (error.status === 401 || error.status === 403 || error.isTerminalStreamAuthorization) {
        invokeHandler(onError, error)
        notifyStreamAuthorizationLost(error, { token: activeToken, path })
        updateStatus('unauthorized')
        return
      }

      if (!error.isExpectedReconnect) {
        retryCount += 1
        rateLimitFailureCount = error.status === 429 ? rateLimitFailureCount + 1 : 0
        if (error.isAuthorizationCheckFailure) {
          authorizationRecoveryActive = true
          authorizationCheckFailureCount += 1
        }
        invokeHandler(onError, error)
      } else {
        rateLimitFailureCount = 0
      }

      retryAfterMs = error.status === 429 ? error.retryAfterMs || 0 : 0

      if (error.isExpectedReconnect) {
        updateStatus('reconnecting')
      } else if (authorizationRecoveryActive) {
        updateStatus(authorizationCheckFailureCount >= 3 || retryCount >= 3 ? 'degraded' : 'reconnecting')
      } else if (error.status === 429) {
        if (rateLimitFailureCount >= 3 && !fallbackStarted) {
          fallbackStarted = true
          updateStatus('degraded')
          invokeHandler(onFallback)
        } else if (!fallbackStarted) {
          updateStatus('reconnecting')
        }
      } else if (retryCount >= 3 && !fallbackStarted) {
        fallbackStarted = true
        updateStatus('degraded')
        invokeHandler(onFallback)
      } else if (!fallbackStarted) {
        updateStatus('reconnecting')
      }

      const retryDelay = calculateRetryDelay({
        isExpectedReconnect: error.isExpectedReconnect,
        retryCount,
        retryAfterMs,
      })
      retryTimer = window.setTimeout(connect, retryDelay)
    }
  }

  connect()

  return () => {
    isClosed = true
    controller.abort()
    clearStabilityTimer()
    clearInactivityTimer()
    releaseActiveReader({ cancel: true })

    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
  }
}
