const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function authHeader() {
  const token = jwt.sign({ username: 'admin', role: 'Admin' }, JWT_SECRET, {
    subject: USER_ID,
    expiresIn: '1h',
  })
  return { Authorization: `Bearer ${token}` }
}

async function withSlowSupabase(testFn) {
  let observeCancellation
  let cancellationObserved = false
  const cancelled = new Promise((resolve) => {
    observeCancellation = (value) => {
      if (cancellationObserved) return
      cancellationObserved = true
      resolve(value)
    }
  })
  const server = http.createServer((request, response) => {
    response.once('close', () => {
      if (!response.writableEnded) observeCancellation(true)
    })
    setTimeout(() => {
      if (response.destroyed) {
        observeCancellation(true)
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('[]')
      observeCancellation(false)
    }, 750)
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))

  try {
    const { port } = server.address()
    return await testFn(`http://127.0.0.1:${port}`, cancelled)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('ordinary API requests return a controlled 504 before the frontend timeout', async (t) => {
  const previousTimeout = process.env.API_REQUEST_TIMEOUT_MS
  const previousSupabaseUrl = process.env.SUPABASE_URL
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.API_REQUEST_TIMEOUT_MS = '500'
  t.after(() => {
    if (previousTimeout === undefined) delete process.env.API_REQUEST_TIMEOUT_MS
    else process.env.API_REQUEST_TIMEOUT_MS = previousTimeout
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = previousSupabaseUrl
    if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey
  })

  await withSlowSupabase(async (supabaseUrl, upstreamCancelled) => {
    process.env.SUPABASE_URL = supabaseUrl
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    const app = loadAppWithMocks()

    await withTestServer(app, async (baseUrl) => {
      const { response, body } = await requestJson(baseUrl, '/api/dashboard/overview', {
        headers: authHeader(),
      })

      assert.equal(response.status, 504)
      assert.deepEqual(body, {
        error: {
          code: 'UPSTREAM_TIMEOUT',
          message: 'The data service did not respond in time. Please try again.',
        },
      })
      assert.equal(await upstreamCancelled, true)
    })
  })
})

test('committed streaming responses are not aborted by the ordinary request deadline', async () => {
  const requestDeadline = require('../src/middleware/requestDeadline')
  const app = express()
  app.use(requestDeadline)
  app.get('/stream', (request, response) => {
    response.type('text/plain')
    response.write('open\n')
    setTimeout(() => response.end(String(request.requestSignal.aborted)), 650)
  })

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/stream`)
    assert.equal(await response.text(), 'open\nfalse')
  })
})

test('client disconnect aborts request work immediately', async () => {
  const requestDeadline = require('../src/middleware/requestDeadline')
  const app = express()
  let observeAbort
  const aborted = new Promise((resolve) => {
    observeAbort = resolve
  })

  app.use(requestDeadline)
  app.get('/disconnect', (request, response) => {
    request.requestSignal.addEventListener('abort', () => {
      observeAbort(request.requestSignal.reason)
    }, { once: true })
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.write('open')
  })

  await withTestServer(app, async (baseUrl) => {
    const request = http.get(`${baseUrl}/disconnect`)
    request.on('response', () => request.destroy())
    request.on('error', () => {})

    const reason = await aborted
    assert.equal(reason.code, 'CLIENT_DISCONNECTED')
    assert.equal(reason.status, 499)
  })
})
