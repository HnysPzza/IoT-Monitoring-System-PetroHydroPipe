const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
process.env.SSE_HEARTBEAT_INTERVAL_MS = '100'
process.env.SSE_AUTH_REVALIDATION_INTERVAL_MS = '20'
process.env.SSE_AUTH_REVALIDATION_TIMEOUT_MS = '5'
process.env.SSE_MAX_CONNECTION_LIFETIME_MS = '3000'
process.env.SSE_MAX_PENDING_EVENTS = '2'
process.env.SSE_MAX_PENDING_BYTES = '1024'

const { createConnectionRegistry } = require('../src/shared/sse/connectionRegistry')
const admitSseConnection = require('../src/middleware/admitSseConnection')
const { closeAllSseStreams, openSseStream, serializeEvent } = require('../src/shared/sse/openSseStream')
const { getSseMetrics } = require('../src/shared/sse/metrics')
const logger = require('../src/utils/logger')

class MockResponse extends EventEmitter {
  constructor(writeResults = []) {
    super()
    this.frames = []
    this.writeResults = [...writeResults]
    this.writableEnded = false
    this.destroyed = false
    this.headers = {}
  }

  set(headers) {
    Object.assign(this.headers, headers)
  }

  flushHeaders() {}

  write(frame) {
    this.frames.push(frame)
    return this.writeResults.length > 0 ? this.writeResults.shift() : true
  }

  end() {
    if (this.writableEnded) return
    this.writableEnded = true
    this.emit('close')
  }

  destroy() {
    this.destroyed = true
    this.emit('close')
  }
}

function createRequest({ expiresAtMs = Date.now() + 60_000 } = {}) {
  const request = new EventEmitter()
  request.tokenPayload = { sub: 'user-1', exp: Math.ceil(expiresAtMs / 1000) }
  request.user = { id: 'user-1', role: 'Admin' }
  request.socket = { setTimeout() {} }
  request.sseConnectionRelease = () => {}
  return request
}

async function waitFor(predicate, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs

  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for SSE state change.')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function openTestStream({ req = createRequest(), res = new MockResponse(), subscribe, revalidateUser } = {}) {
  let listener = null
  let unsubscribeCalls = 0
  const close = openSseStream({
    req,
    res,
    streamName: 'test',
    allowedRoles: ['Admin'],
    allowedEventNames: ['alert.created'],
    subscribe: subscribe || ((nextListener) => {
      listener = nextListener
      return () => { unsubscribeCalls += 1 }
    }),
    toClientEvent: (event) => ({ type: event.type, payload: { alert: event.alert } }),
    revalidateUser: revalidateUser || (async () => ({ id: 'user-1', role: 'Admin' })),
  })

  return {
    close,
    emit: (event) => listener?.(event),
    getUnsubscribeCalls: () => unsubscribeCalls,
    req,
    res,
  }
}

test('connection registry enforces combined user, IP, and global caps with idempotent release', () => {
  const registry = createConnectionRegistry({ maxPerUser: 2, maxPerIp: 2, maxTotal: 3 })
  const first = registry.acquire({ userId: 'user-1', ip: '127.0.0.1' })
  const second = registry.acquire({ userId: 'user-1', ip: '127.0.0.2' })

  assert.equal(typeof first.release, 'function')
  assert.equal(typeof second.release, 'function')
  const userLimited = registry.acquire({ userId: 'user-1', ip: '127.0.0.3' })
  assert.equal(userLimited.release, null)
  assert.equal(userLimited.limit, 'user')
  assert.deepEqual(userLimited.counts, { total: 2, user: 2, ip: 0 })
  const third = registry.acquire({ userId: 'user-2', ip: '127.0.0.1' })
  assert.equal(typeof third.release, 'function')
  const totalLimited = registry.acquire({ userId: 'user-3', ip: '127.0.0.3' })
  assert.equal(totalLimited.release, null)
  assert.equal(totalLimited.limit, 'total')

  first.release()
  first.release()
  second.release()
  third.release()
  assert.deepEqual(registry.getCounts(), {
    total: 0,
    users: new Map(),
    ips: new Map(),
  })

  const ipRegistry = createConnectionRegistry({ maxPerUser: 3, maxPerIp: 2, maxTotal: 5 })
  assert.equal(typeof ipRegistry.acquire({ userId: 'user-1', ip: 'shared-ip' }).release, 'function')
  assert.equal(typeof ipRegistry.acquire({ userId: 'user-2', ip: 'shared-ip' }).release, 'function')
  const ipLimited = ipRegistry.acquire({ userId: 'user-3', ip: 'shared-ip' })
  assert.equal(ipLimited.release, null)
  assert.equal(ipLimited.limit, 'ip')
})

test('SSE admission releases a lease when the request aborts or response closes before stream setup', () => {
  const { connectionRegistry } = require('../src/shared/sse/connectionRegistry')
  const req = createRequest()
  const res = new MockResponse()
  let nextCalls = 0

  admitSseConnection(req, res, () => { nextCalls += 1 })

  assert.equal(nextCalls, 1)
  assert.equal(connectionRegistry.getCounts().total, 1)

  req.emit('aborted')
  res.destroy()

  assert.equal(connectionRegistry.getCounts().total, 0)
  assert.equal(req.sseConnectionRelease, null)
  assert.equal(req.sseConnectionHandoff, null)

  let subscribeCalls = 0
  openTestStream({
    req,
    res,
    subscribe: () => {
      subscribeCalls += 1
      return () => {}
    },
  })
  assert.equal(subscribeCalls, 0)

  const destroyedReq = createRequest()
  const destroyedRes = new MockResponse()
  admitSseConnection(destroyedReq, destroyedRes, () => {})
  destroyedRes.destroy()
  assert.equal(connectionRegistry.getCounts().total, 0)
})

test('openSseStream claims an admitted lease and releases it once on normal close', () => {
  const { connectionRegistry } = require('../src/shared/sse/connectionRegistry')
  const req = createRequest()
  const res = new MockResponse()
  admitSseConnection(req, res, () => {})

  const stream = openTestStream({ req, res })
  assert.equal(connectionRegistry.getCounts().total, 1)

  stream.close({ reason: 'test_complete' })
  stream.close({ reason: 'duplicate_close' })

  assert.equal(connectionRegistry.getCounts().total, 0)
})

test('SSE serialization writes one complete UTF-8 frame and rejects unsupported event names', () => {
  assert.equal(
    serializeEvent('alert.created', { message: 'válido' }, new Set(['alert.created'])),
    'event: alert.created\ndata: {"message":"válido"}\n\n',
  )
  assert.throws(
    () => serializeEvent('alert.created\ndata: injected', {}, new Set(['alert.created\ndata: injected'])),
    /unsupported SSE event/,
  )
})

test('an unsupported publisher event closes only that stream and does not escape the listener', () => {
  const stream = openTestStream()

  assert.doesNotThrow(() => {
    stream.emit({ type: 'alert.created\ndata: injected', alert: { id: 'unsafe' } })
  })
  assert.equal(stream.res.writableEnded, true)
  assert.equal(stream.getUnsubscribeCalls(), 1)
})

test('backpressure queues only later frames, skips heartbeats, and closes at the bounded queue limit', () => {
  const req = createRequest()
  let releaseCalls = 0
  req.sseConnectionRelease = () => { releaseCalls += 1 }
  const res = new MockResponse([false])
  const stream = openTestStream({ req, res })

  stream.emit({ type: 'alert.created', alert: { id: 'one' } })
  stream.emit({ type: 'alert.created', alert: { id: 'two' } })
  stream.emit({ type: 'alert.created', alert: { id: 'overflow' } })

  assert.equal(res.frames.length, 1, 'write(false) accepted the heartbeat and must not be duplicated')
  assert.match(res.frames[0], /event: heartbeat/)
  assert.equal(res.destroyed, true)
  assert.equal(stream.getUnsubscribeCalls(), 1)
  assert.equal(releaseCalls, 1)
})

test('drain flushes queued frames in order exactly once', () => {
  const res = new MockResponse([false, true, true])
  const stream = openTestStream({ res })

  stream.emit({ type: 'alert.created', alert: { id: 'first' } })
  stream.emit({ type: 'alert.created', alert: { id: 'second' } })

  assert.equal(res.frames.length, 1)
  res.emit('drain')

  assert.equal(res.frames.length, 3)
  assert.match(res.frames[1], /"id":"first"/)
  assert.match(res.frames[2], /"id":"second"/)
  assert.equal(res.frames.filter((frame) => frame.includes('"id":"first"')).length, 1)
  assert.equal(res.frames.filter((frame) => frame.includes('"id":"second"')).length, 1)
  stream.close({ reason: 'test_complete' })
})

test('backpressure closes when pending UTF-8 bytes exceed the configured limit', () => {
  const res = new MockResponse([false])
  const stream = openTestStream({ res })

  stream.emit({ type: 'alert.created', alert: { message: '\u00e9'.repeat(470) } })
  assert.equal(res.writableEnded, false)

  stream.emit({ type: 'alert.created', alert: { id: 'over-byte-limit' } })

  assert.equal(res.destroyed, true)
  assert.equal(stream.getUnsubscribeCalls(), 1)
})

test('closing during a stalled authorization check aborts the database request and settles immediately', async () => {
  const res = new MockResponse()
  let observedSignal = null
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const stream = openTestStream({
    res,
    revalidateUser: (tokenPayload, { signal }) => {
      observedSignal = signal
      markStarted()
      return new Promise(() => {})
    },
  })

  await started
  stream.close({ reason: 'test_complete' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(observedSignal.aborted, true)
  assert.equal(res.writableEnded, true)
  assert.equal(stream.getUnsubscribeCalls(), 1)
})

test('drain discards queued application events when the JWT deadline has passed', () => {
  const originalNow = Date.now
  const now = originalNow()
  const req = createRequest({ expiresAtMs: now + 10_000 })
  const res = new MockResponse([false])
  const stream = openTestStream({ req, res })
  stream.emit({ type: 'alert.created', alert: { id: 'queued' } })

  Date.now = () => req.tokenPayload.exp * 1000
  try {
    res.emit('drain')
  } finally {
    Date.now = originalNow
  }

  assert.equal(res.frames.some((frame) => frame.includes('queued')), false)
  assert.equal(res.destroyed, true)
  assert.equal(stream.getUnsubscribeCalls(), 1)
})

test('drain rechecks authorization before every queued frame', () => {
  const originalNow = Date.now
  const now = originalNow()
  const req = createRequest({ expiresAtMs: now + 10_000 })
  const res = new MockResponse([false])
  const stream = openTestStream({ req, res })
  stream.emit({ type: 'alert.created', alert: { id: 'first' } })
  stream.emit({ type: 'alert.created', alert: { id: 'second' } })

  let checks = 0
  Date.now = () => {
    checks += 1
    return checks < 3 ? now : req.tokenPayload.exp * 1000
  }
  try {
    res.emit('drain')
  } finally {
    Date.now = originalNow
  }

  assert.equal(res.frames.some((frame) => frame.includes('first')), true)
  assert.equal(res.frames.some((frame) => frame.includes('second')), false)
  assert.equal(res.writableEnded, true)
})

test('an expiry race before the first heartbeat releases admission without subscribing', () => {
  const originalNow = Date.now
  const now = originalNow()
  const req = createRequest({ expiresAtMs: now + 10_000 })
  let releaseCalls = 0
  let subscribeCalls = 0
  req.sseConnectionRelease = () => { releaseCalls += 1 }
  Date.now = () => req.tokenPayload.exp * 1000

  try {
    openTestStream({
      req,
      subscribe: () => {
        subscribeCalls += 1
        return () => {}
      },
    })
  } finally {
    Date.now = originalNow
  }

  assert.equal(subscribeCalls, 0)
  assert.equal(releaseCalls, 1)
})

test('the exact JWT expiry timer closes the stream and blocks later publisher events', async () => {
  const req = createRequest({ expiresAtMs: Date.now() + 50 })
  const stream = openTestStream({ req })
  const waitMs = Math.max(0, (req.tokenPayload.exp * 1000) - Date.now()) + 20

  await new Promise((resolve) => setTimeout(resolve, waitMs))
  const frameCountAtExpiry = stream.res.frames.length
  stream.emit({ type: 'alert.created', alert: { id: 'too-late' } })

  assert.equal(stream.res.writableEnded, true)
  assert.equal(stream.res.frames.some((frame) => frame.includes('event: stream.auth_expired')), true)
  assert.equal(stream.res.frames.length, frameCountAtExpiry)
  assert.equal(stream.res.frames.some((frame) => frame.includes('too-late')), false)
})

test('periodic current-user revalidation closes a stream after a role change', async () => {
  const res = new MockResponse()
  const stream = openTestStream({
    res,
    revalidateUser: async () => ({ id: 'user-1', role: 'Viewer' }),
  })

  await waitFor(() => res.writableEnded)

  assert.equal(res.writableEnded, true)
  assert.equal(stream.getUnsubscribeCalls(), 1)
  assert.equal(res.frames.some((frame) => frame.includes('event: stream.auth_revoked')), true)
  assert.equal(res.frames.some((frame) => frame.includes('account_or_role_changed')), true)
})

test('periodic current-user revalidation emits a safe validation control event', async () => {
  const stream = openTestStream()

  await waitFor(() => stream.res.frames.some((frame) => frame.includes('event: stream.auth_validated')))

  const validationFrame = stream.res.frames.find((frame) => frame.includes('event: stream.auth_validated'))
  assert.match(validationFrame, /"timestamp":"[^"]+"/)
  assert.equal(validationFrame.includes('user-1'), false)
  assert.equal(stream.res.writableEnded, false)
  stream.close({ reason: 'test_complete' })
})

test('periodic current-user revalidation closes inactive, archived, and deleted accounts', async () => {
  for (const status of [401, 403]) {
    const error = new Error('Current account is no longer authorized.')
    error.status = status
    const res = new MockResponse()
    const stream = openTestStream({
      res,
      revalidateUser: async () => { throw error },
    })

    await waitFor(() => res.writableEnded)

    assert.equal(res.writableEnded, true)
    assert.equal(stream.getUnsubscribeCalls(), 1)
    assert.equal(res.frames.some((frame) => frame.includes('event: stream.auth_revoked')), true)
  }
})

test('a stalled authorization query is single-flight and closes with a normal reconnect control', async () => {
  let revalidationCalls = 0
  const res = new MockResponse()
  const stream = openTestStream({
    res,
    revalidateUser: () => {
      revalidationCalls += 1
      return new Promise(() => {})
    },
  })

  await waitFor(() => res.writableEnded)

  assert.equal(revalidationCalls, 1)
  assert.equal(res.writableEnded, true)
  assert.equal(stream.getUnsubscribeCalls(), 1)
  assert.equal(res.frames.some((frame) => frame.includes('event: stream.reconnect')), true)
  assert.equal(res.frames.some((frame) => frame.includes('authorization_check_failed')), true)
})

test('an unexpected authorization revalidation failure is classified without logging sensitive details', async () => {
  const originalWarn = logger.warn
  const warnings = []
  const metricsBefore = getSseMetrics()
  logger.warn = (message, metadata) => warnings.push({ message, metadata })

  try {
    const error = new Error('Database query failed.')
    error.code = 'AUTH_QUERY_FAILED'
    error.status = 500
    const stream = openTestStream({
      revalidateUser: async () => { throw error },
    })

    await waitFor(() => stream.res.writableEnded)

    assert.equal(stream.res.frames.some((frame) => frame.includes('authorization_check_failed')), true)
    assert.equal(stream.getUnsubscribeCalls(), 1)
    assert.equal(getSseMetrics().authRevalidationFailed, metricsBefore.authRevalidationFailed + 1)
    assert.equal(getSseMetrics().authRevalidationTimedOut, metricsBefore.authRevalidationTimedOut)
    assert.deepEqual(warnings, [{
      message: 'SSE authorization revalidation failed.',
      metadata: {
        connectionId: warnings[0].metadata.connectionId,
        errorCode: 'AUTH_QUERY_FAILED',
        failureType: 'auth_query_failed',
        status: 500,
        stream: 'test',
      },
    }])
    assert.match(warnings[0].metadata.connectionId, /^[0-9a-f-]{36}$/i)
    assert.equal(Object.hasOwn(warnings[0].metadata, 'message'), false)
  } finally {
    logger.warn = originalWarn
  }
})

test('an authorization revalidation timeout is classified and counted separately', async () => {
  const originalWarn = logger.warn
  const warnings = []
  const metricsBefore = getSseMetrics()
  let releaseCalls = 0
  const req = createRequest()
  req.sseConnectionRelease = () => { releaseCalls += 1 }
  logger.warn = (message, metadata) => warnings.push({ message, metadata })

  try {
    const stream = openTestStream({
      req,
      revalidateUser: () => new Promise(() => {}),
    })

    await waitFor(() => stream.res.writableEnded)

    assert.equal(getSseMetrics().authRevalidationFailed, metricsBefore.authRevalidationFailed + 1)
    assert.equal(getSseMetrics().authRevalidationTimedOut, metricsBefore.authRevalidationTimedOut + 1)
    assert.equal(releaseCalls, 1)
    assert.deepEqual(warnings, [{
      message: 'SSE authorization revalidation failed.',
      metadata: {
        connectionId: warnings[0].metadata.connectionId,
        errorCode: 'SSE_AUTH_REVALIDATION_TIMEOUT',
        failureType: 'timeout',
        status: null,
        stream: 'test',
      },
    }])
    assert.match(warnings[0].metadata.connectionId, /^[0-9a-f-]{36}$/i)
  } finally {
    logger.warn = originalWarn
  }
})

test('synchronous subscription closure still invokes the returned unsubscribe exactly once', () => {
  let unsubscribeCalls = 0
  const req = createRequest()
  const res = new MockResponse([false])

  openTestStream({
    req,
    res,
    subscribe: (listener) => {
      listener({ type: 'alert.created', alert: { id: 'one' } })
      listener({ type: 'alert.created', alert: { id: 'two' } })
      listener({ type: 'alert.created', alert: { id: 'overflow' } })
      return () => { unsubscribeCalls += 1 }
    },
  })

  assert.equal(res.destroyed, true)
  assert.equal(unsubscribeCalls, 1)
})

test('graceful shutdown closes every active stream and releases its lease', () => {
  let releaseCalls = 0
  const firstReq = createRequest()
  const secondReq = createRequest()
  firstReq.sseConnectionRelease = () => { releaseCalls += 1 }
  secondReq.sseConnectionRelease = () => { releaseCalls += 1 }
  const first = openTestStream({ req: firstReq })
  const second = openTestStream({ req: secondReq })

  closeAllSseStreams()

  assert.equal(first.res.writableEnded, true)
  assert.equal(second.res.writableEnded, true)
  assert.equal(first.getUnsubscribeCalls(), 1)
  assert.equal(second.getUnsubscribeCalls(), 1)
  assert.equal(releaseCalls, 2)
})
