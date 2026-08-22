const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function clearSourceCache() {
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(path.join(backendRoot, 'src'))) delete require.cache[key]
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

function loadPublisher({ throwAlert = false, throwDowntime = false } = {}) {
  clearSourceCache()
  const alerts = []
  const downtime = []
  const logs = []
  mockModule('src/modules/alerts/alerts.service.js', {
    publishAlertAction(action, record) {
      if (throwAlert) throw new Error('listener failed')
      alerts.push({ action, record })
      return true
    },
  })
  mockModule('src/modules/downtime/downtime.service.js', {
    publishDowntimeEvent(type, record) {
      if (throwDowntime) throw new Error('listener failed')
      downtime.push({ type, record })
      return true
    },
  })
  mockModule('src/utils/logger.js', {
    error: (code, metadata) => logs.push({ code, metadata }),
    warn: () => {},
    info: () => {},
  })
  const publisher = require(path.join(backendRoot, 'src', 'modules', 'operations', 'transitionPublisher.js'))
  return { ...publisher, alerts, downtime, logs }
}

test('shared transition publisher emits validated alert and downtime descriptors', () => {
  const publisher = loadPublisher()
  const count = publisher.publishTransitionDescriptors([
    { kind: 'downtime', action: 'created', id: 'down-1', sensorCode: 'S-01', machineCode: 'M-01' },
    { kind: 'alert', action: 'created', record: { id: 'alert-1' } },
  ])
  assert.equal(count, 2)
  assert.equal(publisher.downtime[0].type, 'downtime.created')
  assert.equal(publisher.alerts[0].action, 'created')
})

test('publisher rejects inherited or malformed actions and isolates listener failures', () => {
  const malformed = loadPublisher()
  assert.equal(malformed.publishTransitionDescriptors([
    { kind: 'alert', action: 'toString', record: { id: 'alert-1' } },
    { kind: 'downtime', action: 'constructor', id: 'down-1' },
    { kind: 'unknown', action: 'created', id: 'unknown-1' },
    null,
  ]), 0)
  assert.equal(malformed.logs.length, 4)

  const failures = loadPublisher({ throwAlert: true, throwDowntime: true })
  assert.equal(failures.publishTransitionDescriptors([
    { kind: 'alert', action: 'resolved', record: { id: 'alert-1' } },
    { kind: 'downtime', action: 'resolved', id: 'down-1' },
  ]), 0)
  assert.deepEqual(failures.logs.map((entry) => entry.code), [
    'ALERT_SSE_PUBLISH_FAILED',
    'DOWNTIME_SSE_PUBLISH_FAILED',
  ])
})
