const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '../../..')

function clearSourceCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) delete require.cache[cacheKey]
  })
}

function mockModule(relativePath, exportsValue) {
  const modulePath = path.join(backendRoot, relativePath)
  require.cache[require.resolve(modulePath)] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  }
}

async function captureStreamOptions() {
  clearSourceCache()
  let options = null
  mockModule('src/shared/sse/openSseStream.js', {
    openSseStream: (streamOptions) => {
      options = streamOptions
    },
  })
  mockModule('src/modules/alerts/alerts.service.js', {
    subscribeToAlertEvents: () => () => {},
  })
  const controller = require('../../../src/modules/alerts/alerts.controller')
  await controller.streamAlerts({}, {})
  return options
}

test('alert stream allows sensor.status and sends the live snapshot as its payload', async () => {
  const options = await captureStreamOptions()
  const live = { machine: { status: 'Running' }, sensors: [], monitoring: { capturedAt: '2026-10-31T00:00:00.000Z' } }

  assert.ok(options.allowedEventNames.includes('sensor.status'))
  assert.deepEqual(options.toClientEvent({ type: 'sensor.status', live }), {
    type: 'sensor.status',
    payload: { live },
  })
})

test('alert stream keeps the alert payload shape for alert events', async () => {
  const options = await captureStreamOptions()
  const alert = { id: 'alert-1', revision: '1' }

  assert.deepEqual(options.toClientEvent({ type: 'alert.created', alert }), {
    type: 'alert.created',
    payload: { alert },
  })
})
