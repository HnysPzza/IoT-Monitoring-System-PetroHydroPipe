const assert = require('node:assert/strict')
const express = require('express')
const test = require('node:test')
const errorHandler = require('../../src/middleware/errorHandler')
const requestDeadline = require('../../src/middleware/requestDeadline')
const { getRequestId, runWithRequestSignal } = require('../../src/shared/requestContext')
const logger = require('../../src/utils/logger')
const { withTestServer } = require('../helpers/appTestUtils')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function captureConsole(method, fn) {
  const original = console[method]
  const lines = []
  console[method] = (...args) => lines.push(args)
  try {
    fn()
  } finally {
    console[method] = original
  }
  return lines
}

test('logger writes single-line JSON with metadata and omits requestId outside requests', () => {
  const lines = captureConsole('log', () => {
    logger.info('SERVER_READY', { port: 4000, status: 'ok' })
  })

  assert.equal(lines.length, 1)
  assert.equal(lines[0].length, 1)
  assert.equal(lines[0][0].includes('\n'), false)

  const entry = JSON.parse(lines[0][0])
  assert.equal(entry.level, 'info')
  assert.equal(entry.msg, 'SERVER_READY')
  assert.equal(entry.port, 4000)
  assert.equal(entry.status, 'ok')
  assert.equal(Object.hasOwn(entry, 'requestId'), false)
  assert.ok(!Number.isNaN(Date.parse(entry.ts)))
})

test('logger stamps requestId from requestContext and protects envelope keys', () => {
  const requestId = '11111111-2222-4333-8444-555555555555'
  const lines = captureConsole('warn', () => {
    runWithRequestSignal(new AbortController().signal, () => {
      assert.equal(getRequestId(), requestId)
      logger.warn('RATE_LIMITED', {
        ts: 'spoofed',
        level: 'spoofed',
        requestId: 'spoofed',
        msg: 'spoofed',
        route: '/api/iot/events',
      })
    }, requestId)
  })

  const entry = JSON.parse(lines[0][0])
  assert.equal(entry.level, 'warn')
  assert.equal(entry.msg, 'RATE_LIMITED')
  assert.equal(entry.requestId, requestId)
  assert.equal(entry.route, '/api/iot/events')
  assert.notEqual(entry.ts, 'spoofed')
})

test('logger safely serializes Error, BigInt, shared siblings, and circular objects', () => {
  const shared = { sensor: 'S-03' }
  const circular = { name: 'loop' }
  circular.self = circular

  const normalLines = captureConsole('error', () => {
    logger.error('DB_FAILED', {
      err: new Error('boom'),
      count: 42n,
      first: shared,
      second: shared,
    })
  })
  const normalEntry = JSON.parse(normalLines[0][0])
  assert.equal(normalEntry.err.message, 'boom')
  assert.equal(typeof normalEntry.err.stack, 'string')
  assert.equal(normalEntry.count, '42')
  assert.deepEqual(normalEntry.first, { sensor: 'S-03' })
  assert.deepEqual(normalEntry.second, { sensor: 'S-03' })

  const circularLines = captureConsole('error', () => {
    logger.error('CIRCULAR_META', { circular })
  })
  const circularEntry = JSON.parse(circularLines[0][0])
  assert.equal(circularEntry.circular.self, '[Circular]')

  const badMeta = { toJSON() { throw null } }
  const fallbackLines = captureConsole('error', () => {
    logger.error('THROWING_TOJSON', { badMeta })
  })
  const fallbackEntry = JSON.parse(fallbackLines[0][0])
  assert.equal(fallbackEntry.msg, 'THROWING_TOJSON')
  assert.equal(fallbackEntry.serializationError, 'null')

  const stamp = new Date('2026-11-28T00:00:00.000Z')
  const dateLines = captureConsole('log', () => {
    logger.info('DATE_ARG', stamp)
  })
  const dateEntry = JSON.parse(dateLines[0][0])
  assert.equal(dateEntry.details, '2026-11-28T00:00:00.000Z')
})

test('requestDeadline sets X-Request-Id header and correlates handler and 500 error logs', async () => {
  const app = express()
  app.use('/api', requestDeadline)
  app.get('/api/ok', (_req, res) => {
    logger.info('HANDLER_CALLED', { step: 'ok' })
    res.json({ ok: true })
  })
  app.get('/api/boom', () => {
    const err = new Error('secret database detail')
    err.code = 'DB_EXPLODED'
    throw err
  })
  app.use(errorHandler)

  await withTestServer(app, async (baseUrl) => {
    const infoLines = []
    const originalLog = console.log
    console.log = (...args) => infoLines.push(args)
    let okResponse
    try {
      okResponse = await fetch(`${baseUrl}/api/ok`)
    } finally {
      console.log = originalLog
    }

    const okRequestId = okResponse.headers.get('x-request-id')
    assert.match(okRequestId, UUID_PATTERN)
    const okEntry = JSON.parse(infoLines[0][0])
    assert.equal(okEntry.requestId, okRequestId)
    assert.equal(okEntry.msg, 'HANDLER_CALLED')

    const errorLines = []
    const originalError = console.error
    console.error = (...args) => errorLines.push(args)
    let boomResponse
    let boomBody
    try {
      boomResponse = await fetch(`${baseUrl}/api/boom?token=sensitive`)
      boomBody = await boomResponse.json()
    } finally {
      console.error = originalError
    }

    const boomRequestId = boomResponse.headers.get('x-request-id')
    assert.match(boomRequestId, UUID_PATTERN)
    assert.notEqual(boomRequestId, okRequestId)
    assert.equal(boomResponse.status, 500)
    assert.deepEqual(boomBody, {
      error: {
        code: 'DB_EXPLODED',
        message: 'Unexpected server error.',
      },
    })

    const errorEntry = JSON.parse(errorLines[0][0])
    assert.equal(errorEntry.level, 'error')
    assert.equal(errorEntry.requestId, boomRequestId)
    assert.equal(errorEntry.method, 'GET')
    assert.equal(errorEntry.path, '/api/boom')
    assert.equal(errorEntry.code, 'DB_EXPLODED')
    assert.equal(errorEntry.error.message, 'secret database detail')
  })
})
