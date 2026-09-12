import { createApiError } from '../errors/apiError.js'

const SESSION_CHANNEL_NAME = 'petrohydropipe-session'
const SHARED_SESSION_WAIT_MS = 50

let refresher = null
let sharedSessionHandler = null
let inFlight = null
let sessionChannel = null
let sessionGeneration = 0
let sessionEpoch = 0
let latestSession = null
let acceptSharedSessions = true
const sessionWaiters = new Set()

function normalizeSession(value) {
  if (typeof value === 'string') return { token: value }
  if (value && typeof value.token === 'string') return value
  return null
}

function resolveSessionWaiters(session) {
  for (const resolve of sessionWaiters) resolve(session)
  sessionWaiters.clear()
}

function rememberSession(session, { notify = false } = {}) {
  latestSession = session
  sessionGeneration += 1
  resolveSessionWaiters(session)

  if (notify) sharedSessionHandler?.(session)
}

function endSharedSession({ notify = false } = {}) {
  acceptSharedSessions = false
  latestSession = null
  sessionGeneration += 1
  sessionEpoch += 1
  resolveSessionWaiters(null)

  if (notify) sharedSessionHandler?.(null)
}

function getSessionChannel() {
  if (sessionChannel || typeof BroadcastChannel !== 'function') return sessionChannel

  sessionChannel = new BroadcastChannel(SESSION_CHANNEL_NAME)
  sessionChannel.addEventListener('message', ({ data }) => {
    if (data?.type === 'session-refreshed') {
      if (!acceptSharedSessions) return
      const session = normalizeSession(data.session)
      if (session && latestSession && !matchesSession(session, getSessionContext())) {
        endSharedSession({ notify: true })
        return
      }
      if (session) rememberSession(session, { notify: true })
    }

    if (data?.type === 'session-ended') endSharedSession({ notify: true })
  })
  return sessionChannel
}

function closeSessionChannel() {
  sessionChannel?.close()
  sessionChannel = null
}

function waitForSharedSession(startGeneration) {
  if (sessionGeneration > startGeneration && latestSession) return Promise.resolve(latestSession)

  return new Promise((resolve) => {
    const finish = (session) => {
      globalThis.clearTimeout(timeoutId)
      sessionWaiters.delete(finish)
      resolve(session)
    }
    const timeoutId = globalThis.setTimeout(() => finish(null), SHARED_SESSION_WAIT_MS)
    sessionWaiters.add(finish)
  })
}

async function runRefresher(context, { holdLock = false } = {}) {
  assertSessionCurrent(context)
  const session = normalizeSession(await refresher())
  if (!session || sessionEpoch !== context.generation) return null
  if (!matchesSession(session, context)) {
    endSharedSession({ notify: true })
    throw sessionChangedError()
  }

  rememberSession(session, { notify: true })
  sessionChannel?.postMessage({ type: 'session-refreshed', session })

  if (holdLock && sessionChannel) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  }

  return session
}

async function refreshAcrossTabs(context) {
  const startGeneration = sessionGeneration
  const locks = globalThis.navigator?.locks

  if (!locks?.request || !sessionChannel) return runRefresher(context)

  return withSessionLock(async () => {
    const sharedSession = await waitForSharedSession(startGeneration)
    assertSessionCurrent(context)
    if (sharedSession && matchesSession(sharedSession, context)) return sharedSession
    return runRefresher(context, { holdLock: true })
  })
}

export async function withSessionLock(operation) {
  const locks = globalThis.navigator?.locks
  if (!locks?.request) return operation()
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 15000)
  try {
    return await locks.request('petrohydropipe-session-refresh', { signal: controller.signal }, () => {
      globalThis.clearTimeout(timeout)
      return operation()
    })
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

// Registered by AuthProvider; apiClient and the SSE client call
// refreshSessionOnce() so parallel 401s share one refresh request.
export function setSessionRefresher(nextRefresher, onSharedSession) {
  refresher = typeof nextRefresher === 'function' ? nextRefresher : null
  sharedSessionHandler = typeof onSharedSession === 'function' ? onSharedSession : null
  inFlight = null

  if (refresher) {
    acceptSharedSessions = true
    getSessionChannel()
    return
  }

  endSharedSession()
  closeSessionChannel()
}

export function endSessionAcrossTabs() {
  endSharedSession({ notify: true })
  getSessionChannel()?.postMessage({ type: 'session-ended' })
}

export function getSessionGeneration() {
  return sessionEpoch
}

export function beginSessionChange() {
  endSharedSession()
  inFlight = null
  return sessionEpoch
}

function sessionChangedError() {
  return createApiError('The session changed. Please repeat the action.', 0, null, 'SESSION_CHANGED')
}

function matchesSession(session, context) {
  return (!context.userId || session?.user?.id === context.userId)
    && (!context.sessionId || session?.sessionId === context.sessionId)
}

export function getSessionContext(token) {
  let identity = {}
  if (token) {
    try { identity = JSON.parse(globalThis.atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))) } catch {}
  }
  return {
    generation: sessionEpoch,
    userId: identity.sub || latestSession?.user?.id,
    sessionId: identity.sid || latestSession?.sessionId,
    token,
  }
}

export function assertSessionCurrent(context) {
  if (context.generation !== sessionEpoch || (latestSession && !matchesSession(latestSession, context))) throw sessionChangedError()
}

export function setCurrentSession(session) {
  acceptSharedSessions = true
  rememberSession(session)
  getSessionChannel()?.postMessage({ type: 'session-refreshed', session })
}

function waitForRefresh(operation, signal) {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function refreshSessionOnce(context = getSessionContext(), { signal } = {}) {
  if (!refresher) return Promise.resolve(null)
  try { assertSessionCurrent(context) } catch (error) { return Promise.reject(error) }
  if (context.token && latestSession?.token && latestSession.token !== context.token) {
    return Promise.resolve(latestSession.token)
  }

  if (!inFlight) {
    const operation = refreshAcrossTabs(context)
      .then((session) => session?.token || null)
      .finally(() => {
        if (inFlight === operation) inFlight = null
      })
    inFlight = operation
  }

  return waitForRefresh(inFlight.then((token) => {
    assertSessionCurrent(context)
    return token
  }), signal)
}
