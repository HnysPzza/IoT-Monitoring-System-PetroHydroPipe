const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const machineId = '22222222-2222-4222-8222-222222222222'
const userId = '11111111-1111-4111-8111-111111111111'

function token(role = 'Admin', options = { expiresIn: '1h' }) {
  return jwt.sign({ username: 'fuzz-user', role }, JWT_SECRET, { subject: userId, ...options })
}

function authorization(role = 'Admin') {
  return { Authorization: `Bearer ${token(role)}` }
}

function createFuzzApp(calls) {
  return loadAppWithMocks({
    'src/modules/settings/settings.service.js': {
      getSettingsConstraints: () => ({ sensorCodes: [], outputSensorCode: 'S-05' }),
      getMachineSettings: async () => ({ machineId, version: '1' }),
      updateMachineSettings: async (values) => {
        calls.settingsUpdates.push(values)
        return { machineId, version: '2' }
      },
    },
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => null,
      createHeartbeat: async () => ({}),
      createSensorEvent: async () => ({}),
      getLiveFeed: async () => {
        calls.liveReads += 1
        return { monitoring: { mode: 'disabled' }, machine: null, sensors: [] }
      },
    },
  })
}

test('Phase 4 read endpoints fail closed against token, query, path, and method fuzzing', async () => {
  const calls = { liveReads: 0, settingsUpdates: [] }
  const app = createFuzzApp(calls)

  await withTestServer(app, async (baseUrl) => {
    const badAuthorization = [
      undefined,
      '',
      'Bearer',
      'Bearer null',
      'Basic Zm9vOmJhcg==',
      `Bearer ${token('Admin', { expiresIn: -1 })}`,
      `Bearer ${token('admin')}`,
      `Bearer ${jwt.sign({ sub: userId, role: 'Admin' }, 'wrong-secret')}`,
      'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMTEifQ.',
    ]

    for (const value of badAuthorization) {
      const result = await requestJson(baseUrl, '/api/iot/live', {
        headers: value === undefined ? {} : { Authorization: value },
      })
      assert.ok([401, 403].includes(result.response.status), value)
    }
    assert.equal(calls.liveReads, 0)

    for (const query of [
      '?mode=observe',
      '?mode=observe&mode=enforce',
      '?machine=M-01%00',
      '?constructor[prototype][role]=Admin',
    ]) {
      const result = await requestJson(baseUrl, `/api/iot/live${query}`, { headers: authorization() })
      assert.equal(result.response.status, 400, query)
    }

    for (const path of [
      '/api/iot/live.json',
      '/api/iot/live%2Fsettings',
      '/api/iot/live;admin=true',
      '/api/machines/not-a-uuid/settings',
      `/api/machines/${machineId}%00/settings`,
    ]) {
      const result = await requestJson(baseUrl, path, { headers: authorization() })
      assert.ok([400, 404].includes(result.response.status), path)
    }

    const trailingSlash = await requestJson(baseUrl, '/api/iot/live/', { headers: authorization() })
    assert.equal(trailingSlash.response.status, 200)

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${baseUrl}/api/iot/live`, {
        method,
        headers: { ...authorization(), 'Content-Type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 404, method)
    }

    const override = await requestJson(baseUrl, '/api/iot/live', {
      headers: { ...authorization(), 'X-HTTP-Method-Override': 'PATCH' },
    })
    assert.equal(override.response.status, 200)
    assert.equal(calls.liveReads, 2)
  })
})

test('Phase 4 settings writes reject parser, type, size, and numeric-boundary fuzzing', async () => {
  const calls = { liveReads: 0, settingsUpdates: [] }
  const app = createFuzzApp(calls)

  await withTestServer(app, async (baseUrl) => {
    const endpoint = `${baseUrl}/api/machines/${machineId}/settings`
    const malformedRequests = [
      { contentType: 'text/plain', body: '{"expectedVersion":"1"}' },
      { contentType: 'application/x-www-form-urlencoded', body: 'expectedVersion=1' },
      { contentType: 'application/json', body: '{"expectedVersion":' },
    ]
    for (const item of malformedRequests) {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { ...authorization(), 'Content-Type': item.contentType },
        body: item.body,
      })
      assert.equal(response.status, 400, item.contentType)
    }

    const invalidBodies = [
      null,
      [],
      'settings',
      {},
      { expectedVersion: 1, sensorThresholds: {} },
      { expectedVersion: '0', sensorThresholds: {} },
      { expectedVersion: '01', sensorThresholds: {} },
      { expectedVersion: '-1', sensorThresholds: {} },
      { expectedVersion: '1e3', sensorThresholds: {} },
      {
        expectedVersion: '9'.repeat(100),
        sensorThresholds: {
          'S-01': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null },
        },
      },
      { expectedVersion: '1', sensorThresholds: {}, role: 'Admin' },
      { expectedVersion: '1', sensorThresholds: { '__proto__': {} } },
      { expectedVersion: '1', shiftSchedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 1, constructor: {} } },
    ]
    for (const body of invalidBodies) {
      const result = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
        method: 'PATCH',
        headers: authorization(),
        body,
      })
      assert.equal(result.response.status, 400, JSON.stringify(body)?.slice(0, 120))
    }

    const oversized = await fetch(endpoint, {
      method: 'PATCH',
      headers: { ...authorization(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: '1', padding: 'x'.repeat(110000) }),
    })
    assert.equal(oversized.status, 413)
    assert.equal(calls.settingsUpdates.length, 0)
    assert.equal(Object.prototype.role, undefined)
  })
})
