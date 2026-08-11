const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function clearSourceCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) {
      delete require.cache[cacheKey]
    }
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

function createAlert(overrides = {}) {
  return {
    id: 'alert-1',
    severity: 'Critical',
    status: 'Active',
    title: 'Flux Level Sensor downtime detected',
    message: 'S-04 Flux Level Sensor has no pulse.',
    sourceType: 'sensor',
    machine: { id: 'machine-1', name: 'Spiral Mill 01' },
    sensor: { id: 'sensor-1', sensorCode: 'S-04', label: 'Flux Level Sensor' },
    metadata: { eventType: 'fault', signal: 'fault' },
    createdAt: '2026-06-11T00:00:00.000Z',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    revision: '7',
    ...overrides,
  }
}

function loadAlertService({ rpcResults, rpcCalls = [], logs = [] }) {
  clearSourceCache()
  mockModule('src/database/client.js', {
    getSupabaseClient: () => ({
      rpc(functionName, args) {
        rpcCalls.push({ functionName, args })
        return {
          async single() {
            return rpcResults[functionName]
          },
        }
      },
    }),
  })
  mockModule('src/utils/logger.js', {
    error: (code, metadata) => logs.push({ code, metadata }),
    info: () => {},
    warn: () => {},
  })
  return require(path.join(backendRoot, 'src', 'modules', 'alerts', 'alerts.service.js'))
}

test('alert snapshot returns one database snapshot with decimal-string revisions', async () => {
  const rpcCalls = []
  const alert = createAlert()
  const alertsService = loadAlertService({
    rpcCalls,
    rpcResults: {
      get_alerts_snapshot: {
        data: { alerts: [alert], snapshot_revision: '7' },
        error: null,
      },
    },
  })

  const snapshot = await alertsService.listAlerts()

  assert.deepEqual(snapshot, { alerts: [alert], snapshotRevision: '7' })
  assert.deepEqual(rpcCalls, [{ functionName: 'get_alerts_snapshot', args: undefined }])
})

test('alert snapshot fails closed on malformed revision data', async () => {
  const malformedSnapshots = [
    { alerts: [createAlert({ revision: 7 })], snapshot_revision: '7' },
    { alerts: [createAlert({ revision: '01' })], snapshot_revision: '7' },
    { alerts: [createAlert()], snapshot_revision: '01' },
  ]

  for (const snapshot of malformedSnapshots) {
    const alertsService = loadAlertService({
      rpcResults: {
        get_alerts_snapshot: {
          data: snapshot,
          error: null,
        },
      },
    })

    await assert.rejects(
      () => alertsService.listAlerts(),
      { code: 'ALERT_REVISION_INVALID', status: 500 },
    )
  }
})

test('acknowledgement RPC emits the committed revisioned transition', async () => {
  const rpcCalls = []
  const alert = createAlert({ status: 'Acknowledged', revision: '8' })
  const alertsService = loadAlertService({
    rpcCalls,
    rpcResults: {
      acknowledge_alert: {
        data: {
          outcome: 'acknowledged',
          alert_action: 'acknowledged',
          alert_record: alert,
        },
        error: null,
      },
    },
  })
  let event = null
  const unsubscribe = alertsService.subscribeToAlertEvents((incoming) => {
    event = incoming
  })

  const result = await alertsService.acknowledgeAlert({
    alertId: 'alert-1',
    actorUser: { id: 'user-1' },
  })
  unsubscribe()

  assert.equal(result, alert)
  assert.deepEqual(event, { type: 'alert.acknowledged', alert })
  assert.deepEqual(rpcCalls, [{
    functionName: 'acknowledge_alert',
    args: { p_alert_id: 'alert-1', p_actor_user_id: 'user-1' },
  }])
})

test('acknowledgement after recovery emits resolved while idempotent acknowledgement emits nothing', async () => {
  const resolved = createAlert({ status: 'Resolved', revision: '9' })
  const resolvedService = loadAlertService({
    rpcResults: {
      acknowledge_alert: {
        data: {
          outcome: 'resolved_after_recovery',
          alert_action: 'resolved',
          alert_record: resolved,
        },
        error: null,
      },
    },
  })
  let resolvedEvent = null
  const stopResolved = resolvedService.subscribeToAlertEvents((event) => {
    resolvedEvent = event
  })
  await resolvedService.acknowledgeAlert({ alertId: 'alert-1', actorUser: { id: 'user-1' } })
  stopResolved()
  assert.equal(resolvedEvent.type, 'alert.resolved')

  const acknowledged = createAlert({ status: 'Acknowledged', revision: '10' })
  const idempotentService = loadAlertService({
    rpcResults: {
      acknowledge_alert: {
        data: {
          outcome: 'already_acknowledged',
          alert_action: null,
          alert_record: acknowledged,
        },
        error: null,
      },
    },
  })
  let idempotentEvent = null
  const stopIdempotent = idempotentService.subscribeToAlertEvents((event) => {
    idempotentEvent = event
  })
  const result = await idempotentService.acknowledgeAlert({ alertId: 'alert-1', actorUser: { id: 'user-1' } })
  stopIdempotent()
  assert.equal(result, acknowledged)
  assert.equal(idempotentEvent, null)
})

test('acknowledgement maps missing, resolved, unknown, and database failures to controlled errors', async () => {
  const cases = [
    {
      rpcResult: { data: { outcome: 'not_found' }, error: null },
      expected: { code: 'ALERT_NOT_FOUND', status: 404 },
    },
    {
      rpcResult: { data: { outcome: 'already_resolved' }, error: null },
      expected: { code: 'ALERT_ALREADY_RESOLVED', status: 409 },
    },
    {
      rpcResult: { data: { outcome: 'future_outcome' }, error: null },
      expected: { code: 'ALERT_ACKNOWLEDGE_INVALID', status: 500 },
    },
    {
      rpcResult: { data: null, error: { code: 'XX000' } },
      expected: { code: 'ALERT_ACKNOWLEDGE_FAILED', status: 500 },
    },
  ]

  for (const { rpcResult, expected } of cases) {
    const alertsService = loadAlertService({ rpcResults: { acknowledge_alert: rpcResult } })
    await assert.rejects(
      () => alertsService.acknowledgeAlert({ alertId: 'alert-1', actorUser: { id: 'user-1' } }),
      expected,
    )
  }
})

test('post-commit alert publication isolates a throwing listener and keeps the response successful', async () => {
  const logs = []
  const alert = createAlert({ status: 'Acknowledged', revision: '8' })
  const alertsService = loadAlertService({
    logs,
    rpcResults: {
      acknowledge_alert: {
        data: {
          outcome: 'acknowledged',
          alert_action: 'acknowledged',
          alert_record: alert,
        },
        error: null,
      },
    },
  })
  const stopThrowing = alertsService.subscribeToAlertEvents(() => {
    throw new Error('listener failed')
  })
  let delivered = null
  const stopHealthy = alertsService.subscribeToAlertEvents((event) => {
    delivered = event
  })

  const result = await alertsService.acknowledgeAlert({ alertId: 'alert-1', actorUser: { id: 'user-1' } })
  stopThrowing()
  stopHealthy()

  assert.equal(result, alert)
  assert.equal(delivered.type, 'alert.acknowledged')
  assert.deepEqual(logs, [{
    code: 'ALERT_SSE_PUBLISH_FAILED',
    metadata: { alertId: 'alert-1', action: 'acknowledged' },
  }])
})

test('alert publication allows only exact transition actions and rejects inherited object keys', () => {
  const logs = []
  const alertsService = loadAlertService({ logs, rpcResults: {} })
  const events = []
  const unsubscribe = alertsService.subscribeToAlertEvents((event) => {
    events.push(event)
  })
  const alert = createAlert()

  const mappings = [
    ['created', 'alert.created'],
    ['updated', 'alert.updated'],
    ['resolved', 'alert.resolved'],
    ['acknowledged', 'alert.acknowledged'],
  ]

  mappings.forEach(([action, eventType]) => {
    assert.equal(alertsService.publishAlertAction(action, alert), true)
    assert.equal(events.at(-1).type, eventType)
  })

  assert.equal(alertsService.publishAlertAction('toString', alert), false)
  assert.equal(alertsService.publishAlertAction('constructor', alert), false)
  unsubscribe()

  assert.equal(events.length, mappings.length)
  assert.deepEqual(logs, [
    {
      code: 'ALERT_SSE_TRANSITION_INVALID',
      metadata: { alertId: 'alert-1', action: 'toString' },
    },
    {
      code: 'ALERT_SSE_TRANSITION_INVALID',
      metadata: { alertId: 'alert-1', action: 'constructor' },
    },
  ])
})

test('a committed acknowledgement with an unexpected transition descriptor is returned but not emitted', async () => {
  const logs = []
  const alert = createAlert({ status: 'Acknowledged', revision: '8' })
  const alertsService = loadAlertService({
    logs,
    rpcResults: {
      acknowledge_alert: {
        data: {
          outcome: 'acknowledged',
          alert_action: 'resolved',
          alert_record: alert,
        },
        error: null,
      },
    },
  })
  let event = null
  const unsubscribe = alertsService.subscribeToAlertEvents((incoming) => {
    event = incoming
  })

  const result = await alertsService.acknowledgeAlert({ alertId: 'alert-1', actorUser: { id: 'user-1' } })
  unsubscribe()

  assert.equal(result, alert)
  assert.equal(event, null)
  assert.deepEqual(logs, [{
    code: 'ALERT_ACK_TRANSITION_INVALID',
    metadata: {
      alertId: 'alert-1',
      outcome: 'acknowledged',
      action: 'resolved',
    },
  }])
})
