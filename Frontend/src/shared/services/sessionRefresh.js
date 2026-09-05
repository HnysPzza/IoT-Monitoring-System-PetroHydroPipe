const SESSION_CHANNEL_NAME = 'petrohydropipe-session'
const SHARED_SESSION_WAIT_MS = 50

let refresher = null
let sharedSessionHandler = null
let inFlight = null
let sessionChannel = null
let sessionGeneration = 0
let sessionEpoch = 0
let latestSession = null
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
      const session = normalizeSession(data.session)
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

async function runRefresher(epoch, { holdLock = false } = {}) {
  const session = normalizeSession(await refresher())
  if (!session || sessionEpoch !== epoch) return null

  rememberSession(session)
  sessionChannel?.postMessage({ type: 'session-refreshed', session })

  if (holdLock && sessionChannel) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  }

  return session
}

async function refreshAcrossTabs() {
  const startGeneration = sessionGeneration
  const epoch = sessionEpoch
  const locks = globalThis.navigator?.locks

  if (!locks?.request || !sessionChannel) return runRefresher(epoch)

  try {
    return await locks.request('petrohydropipe-session-refresh', async () => {
      const sharedSession = await waitForSharedSession(startGeneration)
      if (sharedSession) return sharedSession
      if (sessionEpoch !== epoch) return null
      return runRefresher(epoch, { holdLock: true })
    })
  } catch {
    return runRefresher(epoch)
  }
}

// Registered by AuthProvider; apiClient and the SSE client call
// refreshSessionOnce() so parallel 401s share one refresh request.
export function setSessionRefresher(nextRefresher, onSharedSession) {
  refresher = typeof nextRefresher === 'function' ? nextRefresher : null
  sharedSessionHandler = typeof onSharedSession === 'function' ? onSharedSession : null
  inFlight = null

  if (refresher) {
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

export function refreshSessionOnce() {
  if (!refresher) return Promise.resolve(null)

  if (!inFlight) {
    const operation = refreshAcrossTabs()
      .then((session) => session?.token || null)
      .finally(() => {
        if (inFlight === operation) inFlight = null
      })
    inFlight = operation
  }

  return inFlight
}
