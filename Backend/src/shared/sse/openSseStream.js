const authService = require('../../modules/auth/auth.service')
const env = require('../../config/env')
const logger = require('../../utils/logger')
const { incrementSseMetric } = require('./metrics')
const { randomUUID } = require('node:crypto')

const CONTROL_EVENTS = new Set([
  'heartbeat',
  'stream.auth_expired',
  'stream.auth_revoked',
  'stream.auth_validated',
  'stream.reconnect',
])
const activeStreamClosers = new Set()

function serializeEvent(eventName, payload, allowedEvents) {
  if (!allowedEvents.has(eventName) || !/^[a-z][a-z0-9_.-]*$/i.test(eventName)) {
    throw new Error('Attempted to write an unsupported SSE event.')
  }

  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
}

function openSseStream({
  req,
  res,
  allowedRoles,
  allowedEventNames,
  subscribe,
  toClientEvent,
  streamName,
  revalidateUser = authService.getAuthenticatedUser,
}) {
  const allowedEvents = new Set([...CONTROL_EVENTS, ...allowedEventNames])
  const pendingFrames = []
  let pendingBytes = 0
  let backpressured = false
  let closed = false
  let unsubscribe = () => {}
  let heartbeatId = null
  let expiryId = null
  let lifetimeId = null
  let revalidationId = null
  let backpressureTimeoutId = null
  let revalidationInFlight = false
  let authCheckTimeoutId = null
  let cancelAuthCheck = null
  let authCheckAbortController = null
  const expiresAtMs = req.tokenPayload.exp * 1000
  const connectionId = req.sseConnectionId || randomUUID()

  function authorizationExpired() {
    return Date.now() >= expiresAtMs
  }

  function removeListeners() {
    req.off('aborted', handleClientClose)
    res.off('close', handleClientClose)
    res.off('error', handleResponseError)
    res.off('drain', flushPendingFrames)
  }

  function cleanup(reason = 'client_closed') {
    if (closed) return
    closed = true
    clearInterval(heartbeatId)
    clearTimeout(revalidationId)
    clearTimeout(backpressureTimeoutId)
    backpressureTimeoutId = null
    authCheckAbortController?.abort()
    authCheckAbortController = null
    cancelAuthCheck?.()
    cancelAuthCheck = null
    clearTimeout(authCheckTimeoutId)
    authCheckTimeoutId = null
    clearTimeout(expiryId)
    clearTimeout(lifetimeId)
    pendingFrames.length = 0
    pendingBytes = 0
    removeListeners()
    activeStreamClosers.delete(closeStream)

    try {
      unsubscribe()
    } catch (error) {
      logger.warn('Unable to unsubscribe an SSE listener cleanly.', { stream: streamName })
    }

    req.sseConnectionRelease?.()
    req.sseConnectionRelease = null
    incrementSseMetric('closed')
    logger.info('SSE stream closed.', { connectionId, reason, stream: streamName })
  }

  function closeStream({ eventName, payload, reason = 'server_closed', destroy = false } = {}) {
    if (closed) return
    let shouldDestroy = destroy || backpressured

    pendingFrames.length = 0
    pendingBytes = 0

    const mayWriteControlEvent = eventName === 'stream.auth_expired' || !authorizationExpired()

    if (eventName && mayWriteControlEvent && !backpressured && !res.writableEnded && !res.destroyed) {
      try {
        shouldDestroy = !res.write(serializeEvent(eventName, payload, allowedEvents)) || shouldDestroy
      } catch {
        shouldDestroy = true
      }
    }

    cleanup(reason)
    if (shouldDestroy && !res.destroyed) res.destroy()
    else if (!res.writableEnded && !res.destroyed) res.end()
  }

  function handleClientClose() {
    cleanup('client_closed')
  }

  function handleResponseError() {
    cleanup('response_error')
    if (!res.destroyed) res.destroy()
  }

  function releaseBeforeStreamSetup() {
    req.sseConnectionHandoff?.()
    req.sseConnectionHandoff = null
    req.sseConnectionRelease?.()
    req.sseConnectionRelease = null
  }

  function closeForBackpressure(reason = 'backpressure_limit') {
    incrementSseMetric('backpressureClosed')
    closeStream({ reason, destroy: true })
  }

  function clearBackpressureTimeout() {
    clearTimeout(backpressureTimeoutId)
    backpressureTimeoutId = null
  }

  function startBackpressureTimeout() {
    if (backpressureTimeoutId !== null || closed) return
    backpressureTimeoutId = setTimeout(() => {
      backpressureTimeoutId = null
      closeForBackpressure('backpressure_timeout')
    }, env.SSE_BACKPRESSURE_TIMEOUT_MS)
  }

  function enqueueFrame(frame, { heartbeat = false } = {}) {
    if (heartbeat) return true

    const size = Buffer.byteLength(frame)
    if (
      pendingFrames.length >= env.SSE_MAX_PENDING_EVENTS
      || pendingBytes + size > env.SSE_MAX_PENDING_BYTES
    ) {
      closeForBackpressure()
      return false
    }

    pendingFrames.push({ frame, size })
    pendingBytes += size
    return true
  }

  function writeEvent(eventName, payload, { heartbeat = false } = {}) {
    if (closed || res.writableEnded || res.destroyed) return false
    if (authorizationExpired()) {
      incrementSseMetric('authExpired')
      closeStream({
        eventName: 'stream.auth_expired',
        payload: { reason: 'token_expired' },
        reason: 'token_expired',
        destroy: backpressured,
      })
      return false
    }
    const frame = serializeEvent(eventName, payload, allowedEvents)

    if (backpressured) return enqueueFrame(frame, { heartbeat })

    try {
      backpressured = !res.write(frame)
      if (backpressured) startBackpressureTimeout()
      return true
    } catch {
      handleResponseError()
      return false
    }
  }

  function flushPendingFrames() {
    if (closed) return
    if (authorizationExpired()) {
      incrementSseMetric('authExpired')
      closeStream({
        eventName: 'stream.auth_expired',
        payload: { reason: 'token_expired' },
        reason: 'token_expired',
        destroy: backpressured,
      })
      return
    }
    clearBackpressureTimeout()
    backpressured = false

    while (pendingFrames.length > 0 && !backpressured && !closed) {
      if (authorizationExpired()) {
        incrementSseMetric('authExpired')
        closeStream({
          eventName: 'stream.auth_expired',
          payload: { reason: 'token_expired' },
          reason: 'token_expired',
          destroy: backpressured,
        })
        return
      }

      const next = pendingFrames.shift()
      pendingBytes -= next.size

      try {
        backpressured = !res.write(next.frame)
        if (backpressured) startBackpressureTimeout()
      } catch {
        handleResponseError()
      }
    }
  }

  async function revalidateAuthorization() {
    if (closed || revalidationInFlight) return
    revalidationInFlight = true

    try {
      authCheckAbortController = new AbortController()
      const timeoutPromise = new Promise((resolve, reject) => {
        authCheckTimeoutId = setTimeout(() => {
          authCheckAbortController?.abort()
          const error = new Error('SSE authorization revalidation timed out.')
          error.code = 'SSE_AUTH_REVALIDATION_TIMEOUT'
          reject(error)
        }, env.SSE_AUTH_REVALIDATION_TIMEOUT_MS)
      })
      const cancellationPromise = new Promise((resolve, reject) => {
        cancelAuthCheck = () => {
          const error = new Error('SSE authorization revalidation was cancelled.')
          error.code = 'SSE_AUTH_REVALIDATION_CANCELLED'
          reject(error)
        }
      })
      const currentUser = await Promise.race([
        Promise.resolve().then(() => revalidateUser(req.tokenPayload, {
          signal: authCheckAbortController.signal,
        })),
        timeoutPromise,
        cancellationPromise,
      ]).finally(() => {
        clearTimeout(authCheckTimeoutId)
        authCheckTimeoutId = null
        authCheckAbortController = null
        cancelAuthCheck = null
      })
      if (closed) return

      if (!allowedRoles.includes(currentUser.role)) {
        incrementSseMetric('authRevoked')
        closeStream({
          eventName: 'stream.auth_revoked',
          payload: { reason: 'account_or_role_changed' },
          reason: 'authorization_revoked',
        })
      } else {
        writeEvent('stream.auth_validated', { timestamp: new Date().toISOString() })
      }
    } catch (error) {
      if (closed) return

      if (error?.status === 401 || error?.status === 403) {
        incrementSseMetric('authRevoked')
        closeStream({
          eventName: 'stream.auth_revoked',
          payload: { reason: 'account_or_role_changed' },
          reason: 'authorization_revoked',
        })
      } else {
        const errorCode = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
        const status = Number.isInteger(error?.status) ? error.status : null
        incrementSseMetric('authRevalidationFailed')
        if (errorCode === 'SSE_AUTH_REVALIDATION_TIMEOUT') {
          incrementSseMetric('authRevalidationTimedOut')
        }
        logger.warn('SSE authorization revalidation failed.', {
          connectionId,
          errorCode,
          failureType: errorCode === 'SSE_AUTH_REVALIDATION_TIMEOUT'
            ? 'timeout'
            : errorCode === 'AUTH_QUERY_FAILED'
              ? 'auth_query_failed'
              : 'unknown',
          status,
          stream: streamName,
        })
        closeStream({
          eventName: 'stream.reconnect',
          payload: { reason: 'authorization_check_failed' },
          reason: 'authorization_check_failed',
        })
      }
    } finally {
      revalidationInFlight = false
      if (!closed) {
        revalidationId = setTimeout(() => {
          void revalidateAuthorization()
        }, env.SSE_AUTH_REVALIDATION_INTERVAL_MS)
      }
    }
  }

  try {
    if (req.aborted || res.destroyed || res.writableEnded) {
      releaseBeforeStreamSetup()
      return () => {}
    }

    req.sseConnectionHandoff?.()
    req.sseConnectionHandoff = null

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()
    req.socket.setTimeout(0)
    req.socket.setKeepAlive?.(true, env.SSE_TCP_KEEPALIVE_INITIAL_DELAY_MS)

    req.once('aborted', handleClientClose)
    res.once('close', handleClientClose)
    res.once('error', handleResponseError)
    res.on('drain', flushPendingFrames)
    activeStreamClosers.add(closeStream)
    incrementSseMetric('opened')

    writeEvent('heartbeat', {
      intervalMs: env.SSE_HEARTBEAT_INTERVAL_MS,
      ok: true,
      timestamp: new Date().toISOString(),
    }, { heartbeat: true })
    if (closed) return closeStream

    const removeSubscription = subscribe((event) => {
      if (closed) return

      try {
        const clientEvent = toClientEvent(event)
        writeEvent(clientEvent.type, clientEvent.payload)
      } catch {
        closeStream({ reason: 'invalid_event' })
      }
    })
    unsubscribe = typeof removeSubscription === 'function' ? removeSubscription : () => {}

    if (closed) {
      unsubscribe()
      unsubscribe = () => {}
      return closeStream
    }

    heartbeatId = setInterval(() => {
      writeEvent('heartbeat', {
        intervalMs: env.SSE_HEARTBEAT_INTERVAL_MS,
        ok: true,
        timestamp: new Date().toISOString(),
      }, { heartbeat: true })
    }, env.SSE_HEARTBEAT_INTERVAL_MS)

    const expiresInMs = Math.max(0, expiresAtMs - Date.now())
    expiryId = setTimeout(() => {
      incrementSseMetric('authExpired')
      closeStream({
        eventName: 'stream.auth_expired',
        payload: { reason: 'token_expired' },
        reason: 'token_expired',
        destroy: backpressured,
      })
    }, expiresInMs)

    lifetimeId = setTimeout(() => {
      closeStream({
        eventName: 'stream.reconnect',
        payload: { reason: 'max_lifetime' },
        reason: 'max_lifetime',
      })
    }, env.SSE_MAX_CONNECTION_LIFETIME_MS)

    revalidationId = setTimeout(() => {
      void revalidateAuthorization()
    }, env.SSE_AUTH_REVALIDATION_INTERVAL_MS)

    return closeStream
  } catch (error) {
    cleanup('setup_failed')
    if (!res.writableEnded && !res.destroyed) res.end()
    throw error
  }
}

function closeAllSseStreams() {
  for (const closeStream of [...activeStreamClosers]) {
    closeStream({
      eventName: 'stream.reconnect',
      payload: { reason: 'server_shutdown' },
      reason: 'server_shutdown',
    })
  }
}

module.exports = {
  closeAllSseStreams,
  openSseStream,
  serializeEvent,
}
