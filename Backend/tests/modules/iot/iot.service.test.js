const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const bcrypt = require('bcryptjs')

const backendRoot = path.resolve(__dirname, '../../..')
const EVENT_ID = '11111111-1111-4111-8111-111111111111'

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

function createSensorRecord() {
  return {
    id: 'sensor-1',
    sensor_code: 'S-01',
    esp32_device_id: 'esp32-m01-s01',
    label: 'Raw Material Detection',
    status: 'Active',
    device_key_hash: bcrypt.hashSync('device-secret', 4),
    machine_id: 'machine-1',
    machines: {
      id: 'machine-1',
      machine_code: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
      location: 'Production Floor',
    },
  }
}

function createProcessingResult(eventType, signal, overrides = {}) {
  const downtimeAction = eventType === 'fault'
    ? 'created'
    : eventType === 'recovered'
      ? 'resolved'
      : null
  const alertAction = eventType === 'fault'
    ? 'created'
    : eventType === 'recovered'
      ? 'resolved'
      : null

  const result = {
    sensor_event_id: `event-${eventType}`,
    device_event_id: EVENT_ID,
    event_type: eventType,
    event_value: { signal, metadata: {} },
    recorded_at: '2026-06-11T00:00:00.000Z',
    duplicate: false,
    stale: false,
    state_applied: true,
    previous_machine_status: 'Running',
    new_machine_status: eventType === 'fault' ? 'Downtime' : 'Running',
    downtime_action: downtimeAction,
    downtime_id: downtimeAction ? 'downtime-1' : null,
    downtime_sensor_code: downtimeAction ? 'S-03' : null,
    downtime_started_at: downtimeAction ? '2026-06-11T00:00:00.000Z' : null,
    downtime_ended_at: downtimeAction === 'resolved' ? '2026-06-11T00:10:00.000Z' : null,
    downtime_duration_seconds: downtimeAction === 'resolved' ? 600 : null,
    downtime_cause: downtimeAction ? 'Corrective Maintenance' : null,
    alert_action: alertAction,
    alert_record: alertAction
      ? {
        id: 'alert-1',
        status: alertAction === 'resolved' ? 'Resolved' : 'Active',
        revision: alertAction === 'resolved' ? '2' : '1',
      }
      : null,
    ...overrides,
  }

  if (!Object.hasOwn(overrides, 'transition_descriptors')) {
    result.transition_descriptors = result.state_applied
      ? [
        ...(result.downtime_action ? [{
          kind: 'downtime',
          action: result.downtime_action,
          id: result.downtime_id,
          sensorCode: result.downtime_sensor_code,
          machineCode: 'M-01',
        }] : []),
        ...(result.alert_action && result.alert_record ? [{
          kind: 'alert', action: result.alert_action, record: result.alert_record,
        }] : []),
      ]
      : []
  }

  return result
}

function createFakeSupabase({ sensorRecord, processingResult, rpcDataMissing, rpcError, rpcCalls, sensorLookups, sensorSelects }) {
  let lastLookupValue
  return {
    from(tableName) {
      assert.equal(tableName, 'sensors')
      return {
        select(columns) {
          if (sensorSelects) sensorSelects.push(columns)
          return this
        },
        eq(_column, value) {
          lastLookupValue = value
          if (sensorLookups) sensorLookups.push(value)
          return this
        },
        async maybeSingle() {
          const resolved = typeof sensorRecord === 'function' ? sensorRecord(lastLookupValue) : sensorRecord
          return { data: resolved, error: null }
        },
      }
    },
    rpc(functionName, args) {
      rpcCalls.push({ functionName, args })
      return {
        async single() {
          return { data: rpcError || rpcDataMissing ? null : processingResult, error: rpcError || null }
        },
      }
    },
  }
}

function loadIotService({
  eventType,
  signal,
  auditLogs = [],
  auditError = null,
  processingOverrides = {},
  rpcDataMissing = false,
  rpcError = null,
  alertEvents = [],
  downtimeEvents = [],
  rpcCalls = [],
  sensorLookups = [],
  sensorSelects = [],
  sensorOverrides = {},
  sensorRecordOverride,
  alertPublishError = null,
  downtimePublishError = null,
  logs = [],
  envOverrides = {},
  liveStatusRequests = [],
} = {}) {
  clearSourceCache()
  const sensorRecord = sensorRecordOverride !== undefined
    ? sensorRecordOverride
    : { ...createSensorRecord(), ...sensorOverrides }
  const processingResult = createProcessingResult(eventType, signal, processingOverrides)
  const fakeSupabase = createFakeSupabase({
    sensorRecord,
    processingResult,
    rpcDataMissing,
    rpcError,
    rpcCalls,
    sensorLookups,
    sensorSelects,
  })

  if (Object.keys(envOverrides).length > 0) {
    const currentEnv = require(path.join(backendRoot, 'src', 'config', 'env.js'))
    mockModule('src/config/env.js', { ...currentEnv, ...envOverrides })
  }

  mockModule('src/database/client.js', {
    getSupabaseClient: () => fakeSupabase,
  })
  mockModule('src/modules/audit/audit.service.js', {
    recordAuditLog: async (entry) => {
      const resolvedError = typeof auditError === 'function' ? auditError() : auditError
      if (resolvedError) throw resolvedError
      auditLogs.push(entry)
    },
  })
  mockModule('src/modules/alerts/alerts.service.js', {
    publishAlertAction: (action, alert) => {
      if (alertPublishError) throw alertPublishError
      alertEvents.push({ action, alert })
      return true
    },
  })
  mockModule('src/modules/downtime/downtime.service.js', {
    publishDowntimeEvent: (type, downtime) => {
      if (downtimePublishError) throw downtimePublishError
      downtimeEvents.push({ type, downtime })
      return true
    },
  })
  mockModule('src/modules/iot/liveStatusPublisher.js', { requestLiveStatusPublish: () => liveStatusRequests.push(true) })
  mockModule('src/utils/logger.js', {
    error: (code, metadata) => logs.push({ code, metadata }),
    info: () => {},
    warn: () => {},
  })

  return require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
}

async function createTestEvent(eventType, signal, options = {}) {
  const auditLogs = []
  const alertEvents = []
  const downtimeEvents = []
  const rpcCalls = []
  const logs = []
  const iotService = loadIotService({
    eventType,
    signal,
    auditLogs,
    alertEvents,
    downtimeEvents,
    rpcCalls,
    logs,
    ...options,
  })
  const event = await iotService.createSensorEvent({
    sensor: { ...createSensorRecord(), ...(options.sensorOverrides || {}) },
    payload: {
      eventId: EVENT_ID,
      eventType,
      signal,
      recordedAt: '2026-06-11T00:00:00.000Z',
      metadata: options.metadata || {},
    },
  })

  return { alertEvents, auditLogs, downtimeEvents, event, logs, rpcCalls }
}

test('pulse and idle events rely on the atomic RPC without secondary writes', async () => {
  const pulse = await createTestEvent('pulse', 'active')
  const idle = await createTestEvent('idle', 'idle')

  assert.equal(pulse.event.stateApplied, true)
  assert.equal(pulse.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'), false)
  assert.equal(idle.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'), false)
  assert.equal(pulse.alertEvents.length, 0)
  assert.equal(idle.downtimeEvents.length, 0)
  assert.equal(pulse.rpcCalls[0].functionName, 'ingest_iot_sensor_event')
  assert.equal(pulse.rpcCalls[0].args.p_device_event_id, EVENT_ID)
})

test('rejected S-05 output is returned without publishing transitions', async () => {
  const result = await createTestEvent('pulse', 'active', {
    sensorOverrides: { sensor_code: 'S-05' },
    processingOverrides: {
      state_applied: false,
      event_value: {
        signal: 'active',
        metadata: {
          outputAccepted: false,
          outputRejectionReason: 'machine_stationary',
        },
      },
    },
  })

  assert.equal(result.event.outputAccepted, false)
  assert.equal(result.event.outputRejectionReason, 'machine_stationary')
  assert.equal(result.alertEvents.length, 0)
  assert.equal(result.downtimeEvents.length, 0)
})

test('reserved output metadata keys are rejected before calling the ingestion RPC', async () => {
  for (const key of ['outputAccepted', 'outputRejectionReason']) {
    const rpcCalls = []
    const iotService = loadIotService({ eventType: 'pulse', signal: 'active', rpcCalls })

    await assert.rejects(
      () => iotService.createSensorEvent({
        sensor: createSensorRecord(),
        payload: {
          eventId: EVENT_ID,
          eventType: 'pulse',
          signal: 'active',
          recordedAt: '2026-06-11T00:00:00.000Z',
          metadata: { [key]: true },
        },
      }),
      { code: 'SENSOR_EVENT_REJECTED', status: 400 },
    )
    assert.equal(rpcCalls.length, 0)
  }
})

test('malformed S-05 output classification fails closed', async () => {
  await assert.rejects(
    () => createTestEvent('pulse', 'active', {
      sensorOverrides: { sensor_code: 'S-05' },
      processingOverrides: {
        event_value: {
          signal: 'active',
          metadata: {
            outputAccepted: true,
            outputRejectionReason: 'machine_stationary',
          },
        },
      },
    }),
    { code: 'SENSOR_EVENT_RESULT_INVALID', status: 500 },
  )
})

test('partial S-05 output classification fails closed', async () => {
  await assert.rejects(
    () => createTestEvent('pulse', 'active', {
      sensorOverrides: { sensor_code: 'S-05' },
      processingOverrides: {
        event_value: {
          signal: 'active',
          metadata: {
            outputRejectionReason: 'machine_stationary',
          },
        },
      },
    }),
    { code: 'SENSOR_EVENT_RESULT_INVALID', status: 500 },
  )
})

test('explicit faults publish committed downtime and alert transitions from one RPC result', async () => {
  const result = await createTestEvent('fault', 'fault')

  assert.equal(result.auditLogs.length, 0)
  assert.deepEqual(result.alertEvents, [{
    action: 'created',
    alert: {
      id: 'alert-1',
      status: 'Active',
      revision: '1',
    },
  }])
  assert.deepEqual(result.downtimeEvents, [{
    type: 'downtime.created',
    downtime: {
      id: 'downtime-1',
      status: 'Open',
      sensorCode: 'S-03',
      machineCode: 'M-01',
    },
  }])
  assert.equal(result.event.eventId, EVENT_ID)
})

test('grouped downtime responses and SSE transitions identify S-03 as the owner', async () => {
  const result = await createTestEvent('fault', 'fault', {
    processingOverrides: {
      downtime_id: 'downtime-group',
      downtime_sensor_code: 'S-03',
    },
  })

  assert.equal(result.event.downtimeAction, 'created')
  assert.equal(result.event.downtimeSensorCode, 'S-03')
  assert.equal(result.downtimeEvents[0].downtime.sensorCode, 'S-03')
})

test('ingestion publishes every committed descriptor in database order', async () => {
  const processAlert = { id: 'alert-s02', status: 'Active', revision: '3' }
  const downtimeAlert = { id: 'alert-s03', status: 'Active', revision: '4' }
  const result = await createTestEvent('fault', 'fault', {
    processingOverrides: {
      downtime_id: 'downtime-group',
      downtime_sensor_code: 'S-03',
      alert_action: 'created',
      alert_record: downtimeAlert,
      transition_descriptors: [
        { kind: 'alert', action: 'created', record: processAlert },
        { kind: 'downtime', action: 'created', id: 'downtime-group', sensorCode: 'S-03', machineCode: 'M-01' },
        { kind: 'alert', action: 'created', record: downtimeAlert },
      ],
    },
  })

  assert.deepEqual(result.alertEvents, [
    { action: 'created', alert: processAlert },
    { action: 'created', alert: downtimeAlert },
  ])
  assert.deepEqual(result.downtimeEvents, [{
    type: 'downtime.created',
    downtime: { id: 'downtime-group', status: 'Open', sensorCode: 'S-03', machineCode: 'M-01' },
  }])
  assert.equal(result.event.downtimeSensorCode, 'S-03')
})

test('malformed ingestion transition descriptors fail closed', async () => {
  const iotService = loadIotService({
    eventType: 'fault',
    signal: 'fault',
    processingOverrides: { transition_descriptors: null },
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: { eventId: EVENT_ID, eventType: 'fault', signal: 'fault' },
    }),
    { code: 'SENSOR_EVENT_RESULT_INVALID', status: 500 },
  )
})

test('no-pulse observations never publish downtime or alert transitions', async () => {
  const result = await createTestEvent('downtime', 'no_pulse')

  assert.equal(result.event.stateApplied, true)
  assert.equal(result.alertEvents.length, 0)
  assert.equal(result.downtimeEvents.length, 0)
})

test('duplicate and stale events never replay state transitions', async () => {
  const duplicate = await createTestEvent('downtime', 'no_pulse', {
    processingOverrides: { duplicate: true, state_applied: false, downtime_action: null },
  })
  const stale = await createTestEvent('recovered', 'active', {
    processingOverrides: { stale: true, state_applied: false, downtime_action: null },
  })

  assert.equal(duplicate.event.duplicate, true)
  assert.equal(duplicate.auditLogs.length, 0)
  assert.equal(duplicate.alertEvents.length, 0)
  assert.equal(duplicate.downtimeEvents.length, 0)
  assert.equal(stale.event.stale, true)
  assert.equal(stale.auditLogs.length, 0)
  assert.equal(stale.alertEvents.length, 0)
  assert.equal(stale.downtimeEvents.length, 0)
})

test('transaction failure is returned to the device instead of being swallowed', async () => {
  const iotService = loadIotService({
    eventType: 'downtime',
    signal: 'no_pulse',
    rpcError: { code: 'XX000', message: 'database unavailable' },
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: {
        eventId: EVENT_ID,
        eventType: 'downtime',
        signal: 'no_pulse',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: {},
      },
    }),
    { code: 'SENSOR_EVENT_PROCESSING_FAILED', status: 500 },
  )
})

test('an empty RPC result fails with a controlled processing error', async () => {
  const iotService = loadIotService({
    eventType: 'downtime',
    signal: 'no_pulse',
    rpcDataMissing: true,
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: {
        eventId: EVENT_ID,
        eventType: 'downtime',
        signal: 'no_pulse',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: {},
      },
    }),
    { code: 'SENSOR_EVENT_PROCESSING_FAILED', status: 500 },
  )
})

test('invalid timestamps or reused event IDs are rejected as client errors', async () => {
  const iotService = loadIotService({
    eventType: 'downtime',
    signal: 'no_pulse',
    rpcError: { code: '22023', message: 'invalid event' },
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: {
        eventId: EVENT_ID,
        eventType: 'downtime',
        signal: 'no_pulse',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: {},
      },
    }),
    { code: 'SENSOR_EVENT_REJECTED', status: 400 },
  )
})

test('device authentication rejects missing keys, wrong keys, and missing machines', async () => {
  const missingKeyService = loadIotService({ eventType: 'pulse', signal: 'active' })
  await assert.rejects(
    () => missingKeyService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  const wrongKeyService = loadIotService({ eventType: 'pulse', signal: 'active' })
  await assert.rejects(
    () => wrongKeyService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  const missingMachineService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    sensorOverrides: { machines: null },
  })
  await assert.rejects(
    () => missingMachineService.createSensorEvent({
      sensor: { ...createSensorRecord(), machines: null },
      payload: { eventId: EVENT_ID, eventType: 'pulse', signal: 'active' },
    }),
    { code: 'DEVICE_MACHINE_MISSING', status: 500 },
  )
})

test('device authentication caches verified key digests for the configured TTL and skips repeated bcrypt work', async (t) => {
  const sensorLookups = []
  const sensorSelects = []
  const compareCalls = []
  const originalCompare = bcrypt.compare
  t.after(() => {
    bcrypt.compare = originalCompare
  })
  bcrypt.compare = async (candidate, hash) => {
    compareCalls.push({ candidate, hash })
    return originalCompare(candidate, hash)
  }

  const iotService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    sensorLookups,
    sensorSelects,
  })

  const first = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
  })
  const second = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
  })

  const expectedIdentity = {
    id: 'sensor-1',
    sensor_code: 'S-01',
    esp32_device_id: 'esp32-m01-s01',
    machine_id: 'machine-1',
    machines: {
      id: 'machine-1',
      machine_code: 'M-01',
      name: 'Spiral Mill 01',
    },
  }
  assert.deepEqual(first, expectedIdentity)
  assert.deepEqual(second, expectedIdentity)
  assert.equal(sensorLookups.length, 1)
  assert.equal(compareCalls.length, 1)
  assert.equal(sensorSelects[0].includes('status'), false)
  assert.equal(sensorSelects[0].includes('updated_at'), false)

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  const stillCached = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
  })
  assert.deepEqual(stillCached, expectedIdentity)
  assert.equal(sensorLookups.length, 2)
  assert.equal(compareCalls.length, 2)
})

test('createSensorEvent never falls back to stale cached machine status when RPC returns updated or null status', async () => {
  const staleSensor = {
    id: 'sensor-1',
    sensor_code: 'S-01',
    esp32_device_id: 'esp32-m01-s01',
    machine_id: 'machine-1',
    machines: {
      id: 'machine-1',
      machine_code: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
    },
  }

  const downtimeService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    processingOverrides: {
      duplicate: true,
      state_applied: false,
      new_machine_status: 'Downtime',
      downtime_action: null,
    },
  })
  const downtimeEvent = await downtimeService.createSensorEvent({
    sensor: staleSensor,
    payload: {
      eventId: EVENT_ID,
      eventType: 'pulse',
      signal: 'active',
      recordedAt: '2026-06-11T00:00:00.000Z',
    },
  })
  assert.equal(downtimeEvent.machineStatus, 'Downtime')

  const nullStatusService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    processingOverrides: {
      duplicate: true,
      state_applied: false,
      new_machine_status: null,
      downtime_action: null,
    },
  })
  const nullStatusEvent = await nullStatusService.createSensorEvent({
    sensor: staleSensor,
    payload: {
      eventId: EVENT_ID,
      eventType: 'pulse',
      signal: 'active',
      recordedAt: '2026-06-11T00:00:00.000Z',
    },
  })
  assert.equal(nullStatusEvent.machineStatus, null)
})

test('device authentication reloads sensor from database when key rotates while old key is cached', async (t) => {
  const sensorLookups = []
  const compareCalls = []
  const originalCompare = bcrypt.compare
  t.after(() => {
    bcrypt.compare = originalCompare
  })
  bcrypt.compare = async (candidate, hash) => {
    compareCalls.push({ candidate, hash })
    return originalCompare(candidate, hash)
  }

  let currentSensor = createSensorRecord()
  const iotService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    sensorLookups,
    sensorRecordOverride: () => currentSensor,
  })

  const first = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
  })
  assert.equal(first.id, 'sensor-1')
  assert.equal(sensorLookups.length, 1)
  assert.equal(compareCalls.length, 1)

  currentSensor = {
    ...createSensorRecord(),
    device_key_hash: bcrypt.hashSync('rotated-device-secret', 4),
  }

  const rotated = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'rotated-device-secret',
  })
  assert.equal(rotated.id, 'sensor-1')
  assert.equal(sensorLookups.length, 2)
  assert.equal(compareCalls.length, 2)

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'device-secret',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )
})

test('device authentication evicts cached entry immediately when key is revoked in database', async () => {
  let currentSensor = createSensorRecord()
  const iotService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    sensorRecordOverride: () => currentSensor,
  })

  const first = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
  })
  assert.equal(first.id, 'sensor-1')

  currentSensor = {
    ...createSensorRecord(),
    device_key_hash: null,
  }

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key-triggers-recheck',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'device-secret',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )
})

test('device authentication runs dummy bcrypt.compare when sensor or hash is missing to prevent timing enumeration', async (t) => {
  const compareCalls = []
  const originalCompare = bcrypt.compare
  t.after(() => {
    bcrypt.compare = originalCompare
  })
  bcrypt.compare = async (candidate, hash) => {
    compareCalls.push({ candidate, hash })
    return originalCompare(candidate, hash)
  }

  const unknownDeviceService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    sensorRecordOverride: null,
  })

  await assert.rejects(
    () => unknownDeviceService.authenticateDevice({
      deviceId: 'esp32-unknown',
      deviceKey: 'candidate-key',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )
  assert.equal(compareCalls.length, 1)
  assert.equal(compareCalls[0].candidate, 'candidate-key')
  assert.match(compareCalls[0].hash, /^\$2[aby]\$10\$/)

  const missingHashService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    sensorOverrides: { device_key_hash: null },
  })

  await assert.rejects(
    () => missingHashService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'candidate-key-2',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )
  assert.equal(compareCalls.length, 2)
  assert.equal(compareCalls[1].candidate, 'candidate-key-2')
})

test('device authentication deduplicates repeated failure audit logs and throttles brute-force attempts', async () => {
  const auditLogs = []
  const sensorLookups = []
  const iotService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    auditLogs,
    sensorLookups,
    envOverrides: {
      IOT_AUTH_FAILURE_RATE_LIMIT: 3,
      IOT_AUTH_FAILURE_WINDOW_MS: 60_000,
    },
  })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(
      () => iotService.authenticateDevice({
        deviceId: 'esp32-m01-s01',
        deviceKey: `wrong-key-${attempt}`,
      }),
      { code: 'DEVICE_UNAUTHORIZED', status: 401 },
    )
  }

  assert.equal(auditLogs.length, 1)
  assert.equal(auditLogs[0].action, 'IOT_DEVICE_AUTH_FAILED')
  assert.equal(sensorLookups.length, 3)

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key-4',
    }),
    { code: 'RATE_LIMITED', status: 429 },
  )
  assert.equal(sensorLookups.length, 3)
  assert.equal(auditLogs.length, 1)
})

test('device authentication throttles rotating fake device IDs from the same source IP while allowing cached valid devices', async () => {
  const auditLogs = []
  const sensorLookups = []
  const iotService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    auditLogs,
    sensorLookups,
    sensorRecordOverride: (deviceId) => (deviceId === 'esp32-m01-s01' ? createSensorRecord() : null),
    envOverrides: {
      IOT_AUTH_FAILURE_RATE_LIMIT: 2,
      IOT_AUTH_FAILURE_WINDOW_MS: 60_000,
    },
  })

  const verified = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
    sourceIp: '10.0.0.50',
  })
  assert.equal(verified.id, 'sensor-1')
  assert.equal(sensorLookups.length, 1)

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-fake-1',
      deviceKey: 'wrong-key-1',
      sourceIp: '10.0.0.50',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )
  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-fake-2',
      deviceKey: 'wrong-key-2',
      sourceIp: '10.0.0.50',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )
  assert.equal(auditLogs.length, 1)
  assert.equal(auditLogs[0].metadata.reason, 'unknown_device')

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-fake-3',
      deviceKey: 'wrong-key-3',
      sourceIp: '10.0.0.50',
    }),
    { code: 'RATE_LIMITED', status: 429 },
  )
  assert.equal(sensorLookups.length, 3)

  const cachedStillAllowed = await iotService.authenticateDevice({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
    sourceIp: '10.0.0.50',
  })
  assert.equal(cachedStillAllowed.id, 'sensor-1')
  assert.equal(sensorLookups.length, 3)
})

test('device authentication logs IOT_AUTH_AUDIT_LOG_FAILED, still rejects 401, and retries audit on next failure when audit persistence fails', async () => {
  const logs = []
  const auditLogs = []
  let shouldFailAudit = true
  const iotService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    logs,
    auditLogs,
    auditError: () => (shouldFailAudit ? new Error('audit db down') : null),
  })

  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  assert.deepEqual(logs, [{
    code: 'IOT_AUTH_AUDIT_LOG_FAILED',
    metadata: {
      deviceId: 'esp32-m01-s01',
      reason: 'invalid_device_key',
      error: 'audit db down',
    },
  }])
  assert.equal(auditLogs.length, 0)

  shouldFailAudit = false
  await assert.rejects(
    () => iotService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key-2',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )
  assert.equal(auditLogs.length, 1)
  assert.equal(auditLogs[0].action, 'IOT_DEVICE_AUTH_FAILED')
})

test('post-commit downtime and alert publication failures are isolated in both directions', async () => {
  const downtimeFailure = await createTestEvent('fault', 'fault', {
    downtimePublishError: new Error('downtime listener unavailable'),
  })
  assert.equal(downtimeFailure.event.stateApplied, true)
  assert.equal(downtimeFailure.alertEvents.length, 1)
  assert.equal(downtimeFailure.logs[0].code, 'DOWNTIME_SSE_PUBLISH_FAILED')

  const alertFailure = await createTestEvent('fault', 'fault', {
    alertPublishError: new Error('alert listener unavailable'),
  })
  assert.equal(alertFailure.event.stateApplied, true)
  assert.equal(alertFailure.downtimeEvents.length, 1)
  assert.equal(alertFailure.logs[0].code, 'ALERT_SSE_PUBLISH_FAILED')
})

function liveSnapshot(overrides = {}) {
  const snapshotAt = '2026-08-22T00:02:10.000Z'
  const sensors = ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'].map((sensorCode, index) => ({
    id: `10000000-0000-4000-8000-00000000000${index + 2}`,
    sensor_code: sensorCode,
    esp32_device_id: `device-${index + 1}`,
    label: `Sensor ${index + 1}`,
    status: index === 0 ? 'Active' : 'Inactive',
    updated_at: '2026-08-22T00:02:00.000Z',
    latest_event: index === 0 ? {
      id: '20000000-0000-4000-8000-000000000001',
      event_type: 'pulse',
      signal: 'active',
      recorded_at: '2026-08-22T00:02:00.000Z',
    } : null,
    watchdog: {
      connectivity_state: 'online',
      detection_state: index === 0 ? 'healthy' : 'disabled',
      last_heartbeat_received_at: '2026-08-22T00:02:05.000Z',
      last_activity_received_at: index === 0 ? '2026-08-22T00:02:00.000Z' : null,
      last_evaluated_at: '2026-08-22T00:02:05.000Z',
    },
  }))

  return {
    snapshot_at: snapshotAt,
    machine: {
      id: '10000000-0000-4000-8000-000000000001',
      machine_code: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
      location: 'Production Floor',
      updated_at: '2026-08-22T00:00:00.000Z',
    },
    sensors,
    ...overrides,
  }
}

function loadLiveFeedService({ data = liveSnapshot(), error = null, mode = 'observe', calls = [] } = {}) {
  clearSourceCache()
  const fakeSupabase = {
    rpc(functionName, args) {
      calls.push({ functionName, args })
      return {
        async single() {
          return { data, error }
        },
      }
    },
  }

  mockModule('src/database/client.js', { getSupabaseClient: () => fakeSupabase })
  mockModule('src/config/env.js', {
    WATCHDOG_MODE: mode,
    WATCHDOG_TICK_INTERVAL_MS: 15000,
    WATCHDOG_EVALUATION_TIMEOUT_MS: 10000,
    IOT_HEARTBEAT_STALE_AFTER_MS: 30000,
  })
  mockModule('src/modules/audit/audit.service.js', { recordAuditLog: async () => null })
  mockModule('src/modules/operations/transitionPublisher.js', { publishIngestionTransitions: () => null })
  return require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
}

test('live feed uses one snapshot RPC and returns fresh monitoring state', async () => {
  const calls = []
  const service = loadLiveFeedService({ calls })
  const feed = await service.getLiveFeed()

  assert.deepEqual(calls, [{
    functionName: 'get_machine_live_snapshot',
    args: { p_machine_code: 'M-01' },
  }])
  assert.equal(feed.monitoring.mode, 'observe')
  assert.equal(feed.machine.activeSensors, 1)
  assert.equal(feed.machine.lastUpdated, '2026-08-22T00:02:00.000Z')
  assert.equal(feed.sensors[0].signal, 'active')
  assert.equal(feed.sensors[0].monitoring.stateFresh, true)
  assert.equal(feed.sensors[0].monitoring.connectivityState, 'online')
  assert.equal(feed.sensors[0].monitoring.detectionState, 'healthy')
  assert.equal(feed.sensors[1].status, 'Idle')
})

test('live feed derives heartbeat connectivity independently of watchdog mode while masking stale detection state', async () => {
  const disabled = await loadLiveFeedService({ mode: 'disabled' }).getLiveFeed()
  assert.equal(disabled.sensors[0].monitoring.stateFresh, false)
  assert.equal(disabled.sensors[0].monitoring.connectivityState, 'online')
  assert.equal(disabled.sensors[0].monitoring.detectionState, null)

  const staleHbFreshEventSnapshot = liveSnapshot()
  staleHbFreshEventSnapshot.sensors[0].watchdog.connectivity_state = 'offline'
  staleHbFreshEventSnapshot.sensors[0].watchdog.last_heartbeat_received_at = '2026-08-22T00:01:00.000Z'
  const staleHbFreshEvent = await loadLiveFeedService({ data: staleHbFreshEventSnapshot, mode: 'disabled' }).getLiveFeed()
  assert.equal(staleHbFreshEvent.sensors[0].monitoring.connectivityState, 'online')

  const staleHbSnapshot = liveSnapshot()
  staleHbSnapshot.sensors[0].watchdog.last_heartbeat_received_at = '2026-08-22T00:01:00.000Z'
  staleHbSnapshot.sensors[0].watchdog.last_activity_received_at = '2026-08-22T00:01:00.000Z'
  staleHbSnapshot.sensors[0].latest_event.recorded_at = '2026-08-22T00:01:00.000Z'
  const staleHb = await loadLiveFeedService({ data: staleHbSnapshot, mode: 'disabled' }).getLiveFeed()
  assert.equal(staleHb.sensors[0].monitoring.connectivityState, 'offline')

  const noHbSnapshot = liveSnapshot()
  noHbSnapshot.sensors[0].watchdog.connectivity_state = 'unknown'
  noHbSnapshot.sensors[0].watchdog.last_heartbeat_received_at = null
  noHbSnapshot.sensors[0].watchdog.last_activity_received_at = null
  noHbSnapshot.sensors[0].latest_event = null
  const noHb = await loadLiveFeedService({ data: noHbSnapshot, mode: 'disabled' }).getLiveFeed()
  assert.equal(noHb.sensors[0].monitoring.connectivityState, null)

  const snapshot = liveSnapshot()
  snapshot.sensors[0].watchdog.last_evaluated_at = '2026-08-22T00:00:00.000Z'
  const stale = await loadLiveFeedService({ data: snapshot }).getLiveFeed()
  assert.equal(stale.sensors[0].monitoring.stateFresh, false)
  assert.equal(stale.sensors[0].monitoring.connectivityState, 'online')
  assert.equal(stale.sensors[0].monitoring.detectionState, null)
})

test('live feed keeps a single process sensor fault distinct from downtime', async () => {
  const snapshot = liveSnapshot()
  snapshot.sensors[0].status = 'Fault'
  const feed = await loadLiveFeedService({ data: snapshot }).getLiveFeed()

  assert.equal(feed.machine.status, 'Running')
  assert.equal(feed.sensors[0].status, 'Fault')
})

test('live feed keeps S-01, S-02, and S-04 Running while active signal is fresh, Idle within trigger limit, and Fault past trigger limit', async () => {
  for (const sensorIndex of [0, 1, 3]) {
    const runningSnapshot = liveSnapshot()
    runningSnapshot.sensors[sensorIndex].status = 'Inactive'
    runningSnapshot.sensors[sensorIndex].latest_event = {
      id: `20000000-0000-4000-8000-00000000000${sensorIndex + 1}`,
      event_type: 'pulse',
      signal: 'active',
      recorded_at: '2026-08-22T00:02:00.000Z',
    }
    runningSnapshot.sensors[sensorIndex].watchdog.detection_state = 'grace'
    runningSnapshot.sensors[sensorIndex].watchdog.last_activity_received_at = '2026-08-22T00:02:05.000Z'
    const runningFeed = await loadLiveFeedService({ data: runningSnapshot }).getLiveFeed()
    assert.equal(runningFeed.sensors[sensorIndex].status, 'Running')
    assert.equal(runningFeed.sensors[sensorIndex].physicalStatus, 'Active')
    assert.equal(runningFeed.sensors[sensorIndex].monitoring.detectionState, 'healthy')

    const idleSnapshot = liveSnapshot()
    idleSnapshot.sensors[sensorIndex].status = 'Inactive'
    idleSnapshot.sensors[sensorIndex].latest_event = {
      id: `20000000-0000-4000-8000-00000000000${sensorIndex + 1}`,
      event_type: 'idle',
      signal: 'idle',
      recorded_at: '2026-08-22T00:02:00.000Z',
    }
    idleSnapshot.sensors[sensorIndex].watchdog.detection_state = 'healthy'
    const idleFeed = await loadLiveFeedService({ data: idleSnapshot }).getLiveFeed()
    assert.equal(idleFeed.sensors[sensorIndex].status, 'Idle')
    assert.equal(idleFeed.sensors[sensorIndex].physicalStatus, 'Inactive')
    assert.equal(idleFeed.sensors[sensorIndex].monitoring.detectionState, 'grace')

    const faultSnapshot = liveSnapshot()
    faultSnapshot.sensors[sensorIndex].status = 'Fault'
    faultSnapshot.sensors[sensorIndex].latest_event = {
      id: `20000000-0000-4000-8000-00000000000${sensorIndex + 1}`,
      event_type: 'fault',
      signal: 'fault',
      recorded_at: '2026-08-22T00:02:00.000Z',
    }
    faultSnapshot.sensors[sensorIndex].watchdog.detection_state = 'downtime'
    const faultFeed = await loadLiveFeedService({ data: faultSnapshot }).getLiveFeed()
    assert.equal(faultFeed.sensors[sensorIndex].status, 'Fault')
    assert.equal(faultFeed.sensors[sensorIndex].physicalStatus, 'Fault')
    assert.equal(faultFeed.sensors[sensorIndex].monitoring.detectionState, 'downtime')
  }
})

test('live feed keeps S-03 physical input separate from machine downtime authority', async () => {
  const snapshot = liveSnapshot({ machine: { ...liveSnapshot().machine, status: 'Downtime' } })
  snapshot.sensors[2].status = 'Active'

  const feed = await loadLiveFeedService({ data: snapshot }).getLiveFeed()
  const s03 = feed.sensors.find((sensor) => sensor.sensorCode === 'S-03')

  assert.equal(feed.machine.status, 'Downtime')
  assert.equal(s03.status, 'Downtime')
  assert.equal(s03.physicalStatus, 'Active')
})

test('live feed fails closed on database and malformed snapshot results', async () => {
  await assert.rejects(
    () => loadLiveFeedService({ error: { code: 'XX000', message: 'private database detail' } }).getLiveFeed(),
    { status: 500, code: 'LIVE_SNAPSHOT_QUERY_FAILED' },
  )
  await assert.rejects(
    () => loadLiveFeedService({ data: { private: 'invalid' } }).getLiveFeed(),
    { status: 500, code: 'LIVE_SNAPSHOT_INVALID' },
  )
})

test('applied sensor events request a live status publish after the RPC commits', async () => {
  const liveStatusRequests = []
  await createTestEvent('idle', 'idle', { liveStatusRequests })

  assert.equal(liveStatusRequests.length, 1)
})

test('duplicate, stale, and failed sensor events do not request a live status publish', async () => {
  for (const options of [
    { processingOverrides: { duplicate: true, state_applied: false, downtime_action: null } },
    { processingOverrides: { stale: true, state_applied: false, downtime_action: null } },
  ]) {
    const liveStatusRequests = []
    await createTestEvent('pulse', 'active', { ...options, liveStatusRequests })
    assert.equal(liveStatusRequests.length, 0)
  }

  const liveStatusRequests = []
  await assert.rejects(createTestEvent('pulse', 'active', {
    rpcError: { code: 'XX000', message: 'database unavailable' },
    liveStatusRequests,
  }))
  assert.equal(liveStatusRequests.length, 0)
})

test('getDeviceOperationalThresholds returns rotationStallMs only for S-03 with 3000 ms legacy fallback', async () => {
  clearSourceCache()
  let settingsRowData = {
    version: 4,
    sensor_thresholds: {
      'S-01': { absenceDetectionEnabled: true, triggerSeconds: 120, recoverySeconds: 60 },
      'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null },
    },
  }
  mockModule('src/database/client.js', {
    getSupabaseClient: () => ({
      from(table) {
        assert.equal(table, 'machine_operational_settings')
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() { return { data: settingsRowData, error: null } },
        }
      },
    }),
  })
  const iotService = require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
  const baseSensor = createSensorRecord()

  const s01Thresholds = await iotService.getDeviceOperationalThresholds({ ...baseSensor, sensor_code: 'S-01' })
  assert.equal(s01Thresholds.rotationStallMs, undefined)

  const legacyS03 = await iotService.getDeviceOperationalThresholds({ ...baseSensor, sensor_code: 'S-03' })
  assert.equal(legacyS03.rotationStallMs, 3000)

  settingsRowData = {
    version: 5,
    sensor_thresholds: {
      ...settingsRowData.sensor_thresholds,
      'S-03': { absenceDetectionEnabled: true, triggerSeconds: 60, recoverySeconds: 60, rotationStallMs: 5500 },
    },
  }
  const updatedS03 = await iotService.getDeviceOperationalThresholds({ ...baseSensor, sensor_code: 'S-03' })
  assert.equal(updatedS03.rotationStallMs, 5500)

  settingsRowData = {
    version: 6,
    sensor_thresholds: {
      ...settingsRowData.sensor_thresholds,
      'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null, rotationStallMs: 50 },
    },
  }
  const outOfRangeLowS03 = await iotService.getDeviceOperationalThresholds({ ...baseSensor, sensor_code: 'S-03' })
  assert.equal(outOfRangeLowS03.rotationStallMs, 3000)

  settingsRowData = {
    version: 7,
    sensor_thresholds: {
      ...settingsRowData.sensor_thresholds,
      'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null, rotationStallMs: 99999 },
    },
  }
  const outOfRangeHighS03 = await iotService.getDeviceOperationalThresholds({ ...baseSensor, sensor_code: 'S-03' })
  assert.equal(outOfRangeHighS03.rotationStallMs, 3000)
})

test('createSensorEvent with recoveryConfirmed routes to ingest_iot_sensor_event without direct table mutation', async () => {
  const rpcCalls = []
  const tableMutations = []
  const iotService = loadIotService({
    eventType: 'recovered',
    signal: 'active',
    rpcCalls,
  })

  const clientModule = require(path.join(backendRoot, 'src', 'database', 'client.js'))
  const originalGetClient = clientModule.getSupabaseClient
  const client = originalGetClient()
  const originalFrom = client.from.bind(client)
  client.from = (table) => {
    const builder = originalFrom(table)
    return {
      ...builder,
      update(values) {
        tableMutations.push({ table, values })
        return {
          eq() { return this },
          then(resolve) { resolve({ data: null, error: null }) },
        }
      },
    }
  }

  const result = await iotService.createSensorEvent({
    sensor: createSensorRecord(),
    payload: {
      eventId: EVENT_ID,
      eventType: 'recovered',
      signal: 'active',
      metadata: { recoveryConfirmed: true },
    },
  })

  assert.equal(result.id, 'event-recovered')
  assert.equal(tableMutations.length, 0, 'No direct table updates allowed; must use atomic RPC')
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].functionName, 'ingest_iot_sensor_event')
  assert.equal(rpcCalls[0].args.p_event_type, 'recovered')
  assert.deepEqual(rpcCalls[0].args.p_event_value, {
    signal: 'active',
    metadata: { recoveryConfirmed: true },
  })
})

