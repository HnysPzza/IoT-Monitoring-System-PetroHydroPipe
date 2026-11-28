const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { loadAppWithMocks, requestJson, withTestServer } = require('../../helpers/appTestUtils')

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

function startReadinessServer({ status = 200, body = '64', delayMs = 0 } = {}) {
  let hits = 0
  let observeCancellation
  const cancellation = new Promise((resolve) => { observeCancellation = resolve })
  const server = http.createServer((request, response) => {
    hits += 1
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
        getHits: () => hits,
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
    { status: 200, body: '62' },
    { status: 200, body: '61' },
    { status: 200, body: '60' },
    { status: 200, body: '59' },
    { status: 200, body: '58' },
    { status: 200, body: '56' },
    { status: 200, body: '55' },
    { status: 200, body: '54' },
    { status: 200, body: '53' },
    { status: 200, body: '52' },
    { status: 200, body: '51' },
    { status: 200, body: '49' },
    { status: 200, body: '44' },
    { status: 200, body: '35' },
    { status: 200, body: '34' },
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

test('readiness coalesces concurrent checks and caches ready state for 5 seconds', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 })
  const upstream = await startReadinessServer({ delayMs: 120 })
  try {
    await withEnvironment({
      SUPABASE_URL: upstream.url,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      HEALTH_READINESS_TIMEOUT_MS: '500',
    }, async () => {
      const app = loadAppWithMocks()
      await withTestServer(app, async (baseUrl) => {
        const concurrent = await Promise.all(
          Array.from({ length: 5 }, () => requestJson(baseUrl, '/api/health/ready')),
        )
        for (const item of concurrent) assert.equal(item.response.status, 200)
        assert.equal(upstream.getHits(), 1)

        const cached = await requestJson(baseUrl, '/api/health/ready')
        assert.equal(cached.response.status, 200)
        assert.equal(upstream.getHits(), 1)

        context.mock.timers.tick(5001)
        const refreshed = await requestJson(baseUrl, '/api/health/ready')
        assert.equal(refreshed.response.status, 200)
        assert.equal(upstream.getHits(), 2)
      })
    })
  } finally {
    await upstream.close()
  }
})

test('readiness coalesces failures and caches not_ready state for 2 seconds', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 })
  const upstream = await startReadinessServer({ status: 500, body: '{"message":"down"}', delayMs: 80 })
  try {
    await withEnvironment({
      SUPABASE_URL: upstream.url,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      HEALTH_READINESS_TIMEOUT_MS: '500',
    }, async () => {
      const app = loadAppWithMocks()
      await withTestServer(app, async (baseUrl) => {
        const concurrent = await Promise.all(
          Array.from({ length: 3 }, () => requestJson(baseUrl, '/api/health/ready')),
        )
        for (const item of concurrent) assert.equal(item.response.status, 503)
        assert.equal(upstream.getHits(), 1)

        const cached = await requestJson(baseUrl, '/api/health/ready')
        assert.equal(cached.response.status, 503)
        assert.equal(upstream.getHits(), 1)

        context.mock.timers.tick(2001)
        const retried = await requestJson(baseUrl, '/api/health/ready')
        assert.equal(retried.response.status, 503)
        assert.equal(upstream.getHits(), 2)
      })
    })
  } finally {
    await upstream.close()
  }
})

test('readiness endpoint enforces IP rate limit above 30 requests per minute', async () => {
  const upstream = await startReadinessServer()
  try {
    await withEnvironment({
      SUPABASE_URL: upstream.url,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      HEALTH_READINESS_TIMEOUT_MS: '500',
    }, async () => {
      const app = loadAppWithMocks()
      await withTestServer(app, async (baseUrl) => {
        for (let i = 0; i < 30; i += 1) {
          const { response } = await requestJson(baseUrl, '/api/health/ready')
          assert.equal(response.status, 200)
        }
        const limited = await requestJson(baseUrl, '/api/health/ready')
        assert.equal(limited.response.status, 429)
        assert.equal(limited.body?.error?.code, 'RATE_LIMITED')
        assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
      })
    })
  } finally {
    await upstream.close()
  }
})
