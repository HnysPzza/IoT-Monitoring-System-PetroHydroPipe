const assert = require('node:assert/strict')
const test = require('node:test')

const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('../../helpers/appTestUtils')

const heartbeatBody = {
  heartbeatId: '50000000-0000-4000-8000-000000000001',
  bootId: '40000000-0000-4000-8000-000000000001',
  bootCounter: '1',
  sequence: '1',
  recordedAt: '2026-08-22T03:00:00.000Z',
  activityObserved: true,
}

function deviceHeaders(overrides = {}) {
  return {
    'x-device-id': 'esp32-m01-s01',
    'x-device-key': 'device-secret',
    ...overrides,
  }
}

function loadHeartbeatApp({ authenticateDevice, createHeartbeat } = {}) {
  return loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: authenticateDevice || (async () => ({
        id: '30000000-0000-4000-8000-000000000001',
        sensor_code: 'S-01',
        machines: { id: '10000000-0000-4000-8000-000000000001', machine_code: 'M-01' },
      })),
      createHeartbeat: createHeartbeat || (async ({ payload }) => ({
        heartbeatId: payload.heartbeatId,
        sensorCode: 'S-01',
        machineCode: 'M-01',
        receivedAt: '2026-08-22T03:00:00.100Z',
        connectivityState: 'online',
        duplicate: false,
        stale: false,
        stateApplied: true,
      })),
      createSensorEvent: async () => ({}),
      getDeviceOperationalThresholds: async () => ({
        sensorCode: 'S-01',
        machineCode: 'M-01',
        version: '8',
        absenceDetectionEnabled: true,
        triggerSeconds: 45,
        recoverySeconds: 30,
      }),
      getLiveFeed: async () => ({}),
    },
  })
}

test('GET /api/iot/config and POST /api/iot/heartbeats return dynamic device threshold headers', async () => {
  const app = loadHeartbeatApp()

  await withTestServer(app, async (baseUrl) => {
    const configResult = await requestJson(baseUrl, '/api/iot/config', {
      method: 'GET',
      headers: deviceHeaders(),
    })
    assert.equal(configResult.response.status, 200)
    assert.equal(configResult.response.headers.get('x-trigger-seconds'), '45')
    assert.equal(configResult.response.headers.get('x-recovery-seconds'), '30')
    assert.equal(configResult.response.headers.get('x-absence-enabled'), 'true')
    assert.deepEqual(configResult.body, {
      config: {
        sensorCode: 'S-01',
        machineCode: 'M-01',
        version: '8',
        absenceDetectionEnabled: true,
        triggerSeconds: 45,
        recoverySeconds: 30,
      },
    })

    const hbResult = await requestJson(baseUrl, '/api/iot/heartbeats', {
      method: 'POST',
      headers: deviceHeaders(),
      body: heartbeatBody,
    })
    assert.equal(hbResult.response.status, 200)
    assert.equal(hbResult.response.headers.get('x-trigger-seconds'), '45')
    assert.equal(hbResult.response.headers.get('x-recovery-seconds'), '30')
    assert.equal(hbResult.response.headers.get('x-rotation-stall-ms'), null)
  })
})

test('S-03 config and heartbeat responses include x-rotation-stall-ms and rotationStallMs', async () => {
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => ({
        id: '30000000-0000-4000-8000-000000000003',
        sensor_code: 'S-03',
        machines: { id: '10000000-0000-4000-8000-000000000001', machine_code: 'M-01' },
      }),
      createHeartbeat: async ({ payload }) => ({ heartbeatId: payload.heartbeatId, stateApplied: true }),
      createSensorEvent: async () => ({}),
      getDeviceOperationalThresholds: async () => ({
        sensorCode: 'S-03',
        machineCode: 'M-01',
        version: '9',
        absenceDetectionEnabled: true,
        triggerSeconds: 60,
        recoverySeconds: 60,
        rotationStallMs: 4500,
      }),
      getLiveFeed: async () => ({}),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const s03Headers = deviceHeaders({ 'x-device-id': 'esp32-m01-s03' })
    const configResult = await requestJson(baseUrl, '/api/iot/config', {
      method: 'GET',
      headers: s03Headers,
    })
    assert.equal(configResult.response.status, 200)
    assert.equal(configResult.response.headers.get('x-rotation-stall-ms'), '4500')
    assert.equal(configResult.body.config.rotationStallMs, 4500)

    const hbResult = await requestJson(baseUrl, '/api/iot/heartbeats', {
      method: 'POST',
      headers: s03Headers,
      body: heartbeatBody,
    })
    assert.equal(hbResult.response.status, 200)
    assert.equal(hbResult.response.headers.get('x-rotation-stall-ms'), '4500')
  })
})

test('GET /api/iot/config fallback never enables absence detection for S-05 or unconfigured rows', async () => {
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => ({
        id: '30000000-0000-4000-8000-000000000005',
        sensor_code: 'S-05',
        machines: { id: '10000000-0000-4000-8000-000000000001', machine_code: 'M-01' },
      }),
      createHeartbeat: async () => ({}),
      createSensorEvent: async () => ({}),
      getDeviceOperationalThresholds: async () => null,
      getLiveFeed: async () => ({}),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, '/api/iot/config', {
      method: 'GET',
      headers: deviceHeaders({ 'x-device-id': 'esp32-m01-s05' }),
    })
    assert.equal(result.response.status, 200)
    assert.equal(result.body.config.absenceDetectionEnabled, false)
    assert.equal(result.body.config.rotationStallMs, undefined)
  })
})

test('POST /api/iot/heartbeats validates, authenticates, and returns the heartbeat envelope', async () => {
  let authenticated = 0
  let received = null
  const app = loadHeartbeatApp({
    authenticateDevice: async ({ deviceId, deviceKey, sourceIp }) => {
      authenticated += 1
      assert.equal(deviceId, 'esp32-m01-s01')
      assert.equal(deviceKey, 'device-secret')
      assert.equal(typeof sourceIp, 'string')
      assert.ok(sourceIp.length > 0)
      return {
        id: '30000000-0000-4000-8000-000000000001',
        sensor_code: 'S-01',
        device_key_hash: 'must-not-leak',
        machines: { id: '10000000-0000-4000-8000-000000000001', machine_code: 'M-01' },
      }
    },
    createHeartbeat: async ({ sensor, payload }) => {
      received = { sensor, payload }
      return { heartbeatId: payload.heartbeatId, stateApplied: true }
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/iot/heartbeats', {
      method: 'POST',
      headers: deviceHeaders(),
      body: heartbeatBody,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(body, { heartbeat: { heartbeatId: heartbeatBody.heartbeatId, stateApplied: true } })
  })
  assert.equal(authenticated, 1)
  assert.equal(received.payload.bootCounter, '1')
  assert.equal(received.sensor.device_key_hash, undefined)
})

test('heartbeat validation rejects unsafe bigint forms, unknown fields, and missing device headers', async () => {
  let authCalls = 0
  const app = loadHeartbeatApp({ authenticateDevice: async () => { authCalls += 1 } })

  await withTestServer(app, async (baseUrl) => {
    for (const invalidValue of ['0', '-1', '+1', '01', '1.0', '1e2', ' 1', '9223372036854775808']) {
      const result = await requestJson(baseUrl, '/api/iot/heartbeats', {
        method: 'POST',
        headers: deviceHeaders(),
        body: { ...heartbeatBody, sequence: invalidValue },
      })
      assert.equal(result.response.status, 400, invalidValue)
      assertError(result.body, 'VALIDATION_ERROR')
    }

    const unknown = await requestJson(baseUrl, '/api/iot/heartbeats', {
      method: 'POST',
      headers: deviceHeaders(),
      body: { ...heartbeatBody, sensorId: 'attacker-controlled' },
    })
    assert.equal(unknown.response.status, 400)

    const missingHeaders = await requestJson(baseUrl, '/api/iot/heartbeats', {
      method: 'POST',
      headers: { Authorization: 'Bearer dashboard-token' },
      body: heartbeatBody,
    })
    assert.equal(missingHeaders.response.status, 400)
  })
  assert.equal(authCalls, 0)
})

test('heartbeat endpoint preserves controlled authentication, conflict, and internal failures', async () => {
  const cases = [
    { status: 401, code: 'DEVICE_UNAUTHORIZED', message: 'Invalid ESP32 device credentials.' },
    { status: 409, code: 'HEARTBEAT_CONFLICT', message: 'Heartbeat ordering conflicts with device state.' },
    { status: 500, code: 'HEARTBEAT_PROCESSING_FAILED', message: 'private database details' },
  ]

  for (const item of cases) {
    const error = new Error(item.message)
    error.status = item.status
    error.code = item.code
    const app = item.status === 401
      ? loadHeartbeatApp({ authenticateDevice: async () => { throw error } })
      : loadHeartbeatApp({ createHeartbeat: async () => { throw error } })

    await withTestServer(app, async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/iot/heartbeats', {
        method: 'POST',
        headers: deviceHeaders(),
        body: heartbeatBody,
      })
      assert.equal(result.response.status, item.status)
      assertError(result.body, item.code)
      if (item.status === 500) assert.equal(result.body.error.message, 'Unexpected server error.')
    })
  }
})
