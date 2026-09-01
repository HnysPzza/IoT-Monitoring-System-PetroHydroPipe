const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const lifecyclePath = path.resolve(__dirname, '..', 'src', 'serverLifecycle.js')

function loadLifecycle() {
  assert.equal(fs.existsSync(lifecyclePath), true, 'server lifecycle module must exist')
  delete require.cache[require.resolve(lifecyclePath)]
  return require(lifecyclePath)
}

function createLogger() {
  const entries = []
  return {
    entries,
    logger: {
      info: (message, details) => entries.push(['info', message, details]),
      error: (message, details) => entries.push(['error', message, details]),
    },
  }
}

test('normal shutdown stops new traffic and drains owned resources', async () => {
  const { createShutdownHandler } = loadLifecycle()
  const events = []
  const { logger } = createLogger()
  const server = {
    close(callback) {
      events.push('server-close')
      queueMicrotask(callback)
    },
    closeIdleConnections() { events.push('close-idle') },
    closeAllConnections() { events.push('close-all') },
  }
  const shutdown = createShutdownHandler({
    server,
    stopWatchdog: async () => { events.push('watchdog-stop') },
    closeStreams: () => { events.push('streams-close') },
    timeoutMs: 100,
    logger,
    terminate: (code) => events.push(`terminate-${code}`),
    setExitCode: (code) => events.push(`exit-code-${code}`),
  })

  const result = await shutdown('SIGTERM')

  assert.equal(result, 'graceful')
  assert.deepEqual(events, [
    'server-close',
    'streams-close',
    'close-idle',
    'watchdog-stop',
  ])
})

test('duplicate shutdown signals share one lifecycle operation', async () => {
  const { createShutdownHandler } = loadLifecycle()
  let closeCount = 0
  let finishClose
  const server = {
    close(callback) {
      closeCount += 1
      finishClose = callback
    },
    closeIdleConnections() {},
    closeAllConnections() {},
  }
  const shutdown = createShutdownHandler({
    server,
    stopWatchdog: async () => {},
    closeStreams: () => {},
    timeoutMs: 100,
    logger: createLogger().logger,
    terminate: () => assert.fail('graceful shutdown must not terminate forcibly'),
    setExitCode: () => {},
  })

  const first = shutdown('SIGINT')
  const second = shutdown('SIGTERM')
  assert.strictEqual(first, second)
  finishClose()
  assert.equal(await first, 'graceful')
  assert.equal(closeCount, 1)
})

test('shutdown deadline forcibly closes connections and terminates once', async () => {
  const { createShutdownHandler } = loadLifecycle()
  const events = []
  const { logger, entries } = createLogger()
  const server = {
    close() { events.push('server-close') },
    closeIdleConnections() { events.push('close-idle') },
    closeAllConnections() { events.push('close-all') },
  }
  const shutdown = createShutdownHandler({
    server,
    stopWatchdog: () => new Promise(() => {}),
    closeStreams: () => events.push('streams-close'),
    timeoutMs: 20,
    logger,
    terminate: (code) => events.push(`terminate-${code}`),
    setExitCode: (code) => events.push(`exit-code-${code}`),
  })

  assert.equal(await shutdown('SIGTERM'), 'forced')
  assert.deepEqual(events, [
    'server-close',
    'streams-close',
    'close-idle',
    'close-all',
    'terminate-1',
  ])
  assert.equal(entries.some(([level]) => level === 'error'), true)
})

test('forced shutdown still terminates when connection closure throws', async () => {
  const { createShutdownHandler } = loadLifecycle()
  const terminations = []
  const server = {
    close() {},
    closeIdleConnections() {},
    closeAllConnections() { throw new Error('forced close failed') },
  }
  const shutdown = createShutdownHandler({
    server,
    stopWatchdog: () => new Promise(() => {}),
    closeStreams: () => {},
    timeoutMs: 20,
    logger: createLogger().logger,
    terminate: (code) => terminations.push(code),
    setExitCode: () => {},
  })

  assert.equal(await shutdown('SIGTERM'), 'forced')
  assert.deepEqual(terminations, [1])
})

test('shutdown failure records a non-zero exit without skipping cleanup', async () => {
  const { createShutdownHandler } = loadLifecycle()
  const exitCodes = []
  const server = {
    close(callback) { queueMicrotask(() => callback(new Error('close failed'))) },
    closeIdleConnections() {},
    closeAllConnections() {},
  }
  const shutdown = createShutdownHandler({
    server,
    stopWatchdog: async () => { throw new Error('watchdog failed') },
    closeStreams: () => {},
    timeoutMs: 100,
    logger: createLogger().logger,
    terminate: () => assert.fail('completed failure must not use forced termination'),
    setExitCode: (code) => exitCodes.push(code),
  })

  assert.equal(await shutdown('SIGINT'), 'failed')
  assert.deepEqual(exitCodes, [1])
})

test('server listen errors are logged and mark startup failure', () => {
  const { handleServerError } = loadLifecycle()
  const exitCodes = []
  const { logger, entries } = createLogger()

  handleServerError(Object.assign(new Error('address in use'), { code: 'EADDRINUSE' }), {
    logger,
    setExitCode: (code) => exitCodes.push(code),
  })

  assert.deepEqual(exitCodes, [1])
  assert.deepEqual(entries, [[
    'error',
    'API server failed.',
    { code: 'EADDRINUSE' },
  ]])
})
