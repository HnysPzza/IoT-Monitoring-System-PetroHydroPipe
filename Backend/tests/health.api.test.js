const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

function withEnvironment(overrides, action) {
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  )

  return Promise.resolve()
    .then(() => {
      Object.assign(process.env, overrides)
      return action()
    })
    .finally(() => {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
    })
}

function startReadinessServer({ status = 200, body = '29', delayMs = 0 } = {}) {
  let observeCancellation
  const cancellation = new Promise((resolve) => { observeCancellation = resolve })
  const server = http.createServer((request, response) => {
    response.once('close', () => {
      if (!response.writableEnded) observeCancellation(true)
    })
    setTimeout(() => {
      if (response.destroyed) {
        observeCancellation(true)
        return
      }
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(body)
      observeCancellation(false)
    }, delayMs)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        cancellation,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

test('liveness endpoints stay available without database access', async () => {
  await withEnvironment({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, async () => {
    const app = loadAppWithMocks()
    await withTestServer(app, async (baseUrl) => {
      for (const pathName of ['/api/health', '/api/health/live']) {
        const { response, body } = await requestJson(baseUrl, pathName)
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.deepEqual(body, { status: 'ok', service: 'iot-monitoring-backend' })
      }
    })
  })
})

test('readiness returns 200 only for the expected database schema', async () => {
  const upstream = await startReadinessServer()
  try {
    await withEnvironment({
      SUPABASE_URL: upstream.url,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      HEALTH_READINESS_TIMEOUT_MS: '500',
    }, async () => {
      const app = loadAppWithMocks()
      await withTestServer(app, async (baseUrl) => {
        const { response, body } = await requestJson(baseUrl, '/api/health/ready')
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.deepEqual(body, { status: 'ready', service: 'iot-monitoring-backend' })
      })
    })
  } finally {
    await upstream.close()
  }
})

test('readiness fails closed without leaking upstream or schema details', async () => {
  const cases = [
    { status: 200, body: '28' },
    { status: 200, body: '23' },
    { status: 200, body: '{"unexpected":true}' },
    { status: 500, body: '{"message":"database secret detail"}' },
  ]

  for (const scenario of cases) {
    const upstream = await startReadinessServer(scenario)
    try {
      await withEnvironment({
        SUPABASE_URL: upstream.url,
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        HEALTH_READINESS_TIMEOUT_MS: '500',
      }, async () => {
        const app = loadAppWithMocks()
        await withTestServer(app, async (baseUrl) => {
          const { response, body } = await requestJson(baseUrl, '/api/health/ready')
          assert.equal(response.status, 503)
          assert.deepEqual(body, { status: 'not_ready', service: 'iot-monitoring-backend' })
          assert.doesNotMatch(JSON.stringify(body), /secret|schema|supabase/i)
        })
      })
    } finally {
      await upstream.close()
    }
  }
})

test('readiness aborts slow upstream work and returns 503', async () => {
  const upstream = await startReadinessServer({ delayMs: 1_000 })
  try {
    await withEnvironment({
      SUPABASE_URL: upstream.url,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      HEALTH_READINESS_TIMEOUT_MS: '500',
    }, async () => {
      const app = loadAppWithMocks()
      await withTestServer(app, async (baseUrl) => {
        const startedAt = Date.now()
        const { response, body } = await requestJson(baseUrl, '/api/health/ready')
        assert.equal(response.status, 503)
        assert.deepEqual(body, { status: 'not_ready', service: 'iot-monitoring-backend' })
        assert.ok(Date.now() - startedAt < 900)
      })
    })
    assert.equal(await upstream.cancellation, true)
  } finally {
    await upstream.close()
  }
})

test('health endpoints reject unsupported methods and suffixes', async () => {
  const app = loadAppWithMocks()
  await withTestServer(app, async (baseUrl) => {
    for (const [pathName, method] of [
      ['/api/health/live.json', 'GET'],
      ['/api/health/ready-now', 'GET'],
      ['/api/health/ready', 'POST'],
    ]) {
      const { response } = await requestJson(baseUrl, pathName, { method })
      assert.equal(response.status, 404)
    }
  })
})
