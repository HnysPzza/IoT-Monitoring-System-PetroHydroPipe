const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const userId = '11111111-1111-4111-8111-111111111111'

function createToken({ expiresIn = '1h', includeExpiry = true } = {}) {
  const options = { subject: userId }
  if (includeExpiry) options.expiresIn = expiresIn

  return jwt.sign({ username: 'admin', role: 'Admin' }, JWT_SECRET, options)
}

function createServiceMocks() {
  return {
    'src/modules/alerts/alerts.service.js': {
      listAlerts: async () => [],
      acknowledgeAlert: async () => ({}),
      subscribeToAlertEvents: () => () => {},
    },
    'src/modules/downtime/downtime.service.js': {
      listDowntime: async () => ({ records: [], summary: {}, pagination: {} }),
      updateDowntime: async () => ({}),
      subscribeToDowntimeEvents: () => () => {},
    },
  }
}

function streamRequest(baseUrl, path, token, signal) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
}

async function waitForCondition(condition, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs

  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for SSE state change.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('SSE admission rejects a signed token without exp before streaming headers', async () => {
  const app = loadAppWithMocks(createServiceMocks())

  await withTestServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, '/api/alerts/stream', {
      headers: { Authorization: `Bearer ${createToken({ includeExpiry: false })}` },
    })

    assert.equal(result.response.status, 401)
    assert.equal(result.body.error.code, 'UNAUTHENTICATED')
    assert.match(result.response.headers.get('content-type'), /application\/json/)
  })
})

test('alerts and downtime streams close at the signed JWT expiry boundary', async () => {
  const app = loadAppWithMocks(createServiceMocks())

  await withTestServer(app, async (baseUrl) => {
    const assertExpires = async (path) => {
      const response = await streamRequest(baseUrl, path, createToken({ expiresIn: '1s' }))
      const body = await response.text()

      assert.equal(response.status, 200)
      assert.match(body, /event: stream\.auth_expired/)
      assert.match(body, /token_expired/)
    }

    await Promise.all([
      assertExpires('/api/alerts/stream'),
      assertExpires('/api/downtime/stream'),
    ])
  })
})

test('alerts and downtime share the per-user stream cap and release slots on close', async () => {
  const app = loadAppWithMocks(createServiceMocks())
  const { connectionRegistry } = require('../src/shared/sse/connectionRegistry')
  const token = createToken()

  await withTestServer(app, async (baseUrl) => {
    const alertsAbort = new AbortController()
    const downtimeAbort = new AbortController()
    const alerts = await streamRequest(baseUrl, '/api/alerts/stream', token, alertsAbort.signal)
    const downtime = await streamRequest(baseUrl, '/api/downtime/stream', token, downtimeAbort.signal)

    assert.equal(alerts.status, 200)
    assert.equal(downtime.status, 200)
    assert.equal(alerts.headers.get('x-accel-buffering'), 'no')

    const limited = await requestJson(baseUrl, '/api/alerts/stream', {
      headers: { Authorization: `Bearer ${token}` },
    })

    assert.equal(limited.response.status, 429)
    assert.equal(limited.body.error.code, 'SSE_CONNECTION_LIMITED')
    assert.match(limited.response.headers.get('retry-after'), /^\d+$/)

    await alerts.body.cancel()
    alertsAbort.abort()
    await waitForCondition(() => connectionRegistry.getCounts().total === 1)

    const replacementAbort = new AbortController()
    const replacement = await streamRequest(baseUrl, '/api/alerts/stream', token, replacementAbort.signal)
    assert.equal(replacement.status, 200)

    replacementAbort.abort()
    downtimeAbort.abort()
  })
})

test('periodic database role revalidation sends a terminal control event', async () => {
  const previous = {
    interval: process.env.SSE_AUTH_REVALIDATION_INTERVAL_MS,
    timeout: process.env.SSE_AUTH_REVALIDATION_TIMEOUT_MS,
    lifetime: process.env.SSE_MAX_CONNECTION_LIFETIME_MS,
  }
  process.env.SSE_AUTH_REVALIDATION_INTERVAL_MS = '20'
  process.env.SSE_AUTH_REVALIDATION_TIMEOUT_MS = '5'
  process.env.SSE_MAX_CONNECTION_LIFETIME_MS = '1000'
  let authCalls = 0

  let app
  try {
    app = loadAppWithMocks({
      ...createServiceMocks(),
      'src/modules/auth/auth.service.js': {
        login: async () => ({}),
        getAuthenticatedUser: async () => {
          authCalls += 1
          return {
            id: userId,
            name: 'Admin',
            username: 'admin',
            role: authCalls === 1 ? 'Admin' : 'Viewer',
            mustChangePassword: false,
          }
        },
      },
    })
  } finally {
    if (previous.interval === undefined) delete process.env.SSE_AUTH_REVALIDATION_INTERVAL_MS
    else process.env.SSE_AUTH_REVALIDATION_INTERVAL_MS = previous.interval
    if (previous.timeout === undefined) delete process.env.SSE_AUTH_REVALIDATION_TIMEOUT_MS
    else process.env.SSE_AUTH_REVALIDATION_TIMEOUT_MS = previous.timeout
    if (previous.lifetime === undefined) delete process.env.SSE_MAX_CONNECTION_LIFETIME_MS
    else process.env.SSE_MAX_CONNECTION_LIFETIME_MS = previous.lifetime
  }

  await withTestServer(app, async (baseUrl) => {
    const response = await streamRequest(baseUrl, '/api/alerts/stream', createToken())
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.match(body, /event: stream\.auth_revoked/)
    assert.match(body, /account_or_role_changed/)
    assert.equal(authCalls, 2)
  })
})
