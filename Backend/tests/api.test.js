const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('./helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const userId = '11111111-1111-4111-8111-111111111111'
const machineId = '22222222-2222-4222-8222-222222222222'
const sensorId = '33333333-3333-4333-8333-333333333333'

function createToken(role = 'Admin') {
  return jwt.sign(
    {
      username: role.toLowerCase().replaceAll(' ', ''),
      role,
    },
    JWT_SECRET,
    { subject: userId, expiresIn: '1h' },
  )
}

function authHeader(role = 'Admin') {
  return {
    Authorization: `Bearer ${createToken(role)}`,
  }
}

function createHttpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function requestJsonFromLocalAddress(baseUrl, pathName, { localAddress, headers = {}, body }) {
  const url = new URL(pathName, baseUrl)
  const payload = body === undefined ? null : JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      localAddress,
      headers: {
        'Content-Type': 'application/json',
        ...(payload === null ? {} : { 'Content-Length': Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        responseBody += chunk
      })
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          body: responseBody ? JSON.parse(responseBody) : null,
        })
      })
    })

    request.on('error', reject)
    if (payload !== null) request.write(payload)
    request.end()
  })
}

test('GET /api/health returns backend health', async () => {
  const app = loadAppWithMocks()

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/health')

    assert.equal(response.status, 200)
    assert.deepEqual(body, {
      status: 'ok',
      service: 'iot-monitoring-backend',
    })
  })
})

test('GET /api/operations/sse exposes aggregate diagnostics only to admins', async () => {
  const app = loadAppWithMocks()

  await withTestServer(app, async (baseUrl) => {
    const unauthenticated = await requestJson(baseUrl, '/api/operations/sse')
    assert.equal(unauthenticated.response.status, 401)

    const forbidden = await requestJson(baseUrl, '/api/operations/sse', {
      headers: authHeader('Production Supervisor'),
    })
    assert.equal(forbidden.response.status, 403)

    const allowed = await requestJson(baseUrl, '/api/operations/sse', {
      headers: authHeader('Admin'),
    })
    assert.equal(allowed.response.status, 200)
    assert.equal(typeof allowed.body.sse.activeConnections, 'number')
    assert.equal(typeof allowed.body.sse.activeUsers, 'number')
    assert.equal(typeof allowed.body.sse.activeIps, 'number')
    assert.equal(typeof allowed.body.sse.counters.connectionLimited, 'number')
    assert.equal(Object.hasOwn(allowed.body.sse, 'users'), false)
    assert.equal(Object.hasOwn(allowed.body.sse, 'ips'), false)

    const watchdogUnauthenticated = await requestJson(baseUrl, '/api/operations/watchdog')
    assert.equal(watchdogUnauthenticated.response.status, 401)
    const watchdogForbidden = await requestJson(baseUrl, '/api/operations/watchdog', {
      headers: authHeader('Production Supervisor'),
    })
    assert.equal(watchdogForbidden.response.status, 403)
    const watchdogAllowed = await requestJson(baseUrl, '/api/operations/watchdog', {
      headers: authHeader('Admin'),
    })
    assert.equal(watchdogAllowed.response.status, 200)
    assert.equal(watchdogAllowed.response.headers.get('cache-control'), 'no-store')
    assert.equal(watchdogAllowed.body.watchdog.mode, 'disabled')
    assert.equal(watchdogAllowed.body.watchdog.running, false)
    assert.equal(watchdogAllowed.body.watchdog.lastOutcome, 'idle')
    assert.equal(typeof watchdogAllowed.body.watchdog.counters.cycles, 'number')
    assert.equal(typeof watchdogAllowed.body.watchdog.counters.cycleSuccesses, 'number')
    assert.equal(typeof watchdogAllowed.body.watchdog.counters.cyclePartialFailures, 'number')
    assert.equal(typeof watchdogAllowed.body.watchdog.counters.cycleFailures, 'number')
    assert.equal(typeof watchdogAllowed.body.watchdog.counters.cycleCancellations, 'number')
    assert.equal(Object.hasOwn(watchdogAllowed.body.watchdog, 'cycles'), false)
    assert.equal(Object.hasOwn(watchdogAllowed.body.watchdog, 'sensorIds'), false)
    assert.equal(Object.hasOwn(watchdogAllowed.body.watchdog, 'token'), false)
    assert.equal(Object.hasOwn(watchdogAllowed.body.watchdog, 'errorMessage'), false)

    const unexpectedQuery = await requestJson(baseUrl, '/api/operations/watchdog?admin=true', {
      headers: authHeader('Admin'),
    })
    assert.equal(unexpectedQuery.response.status, 400)
    assertError(unexpectedQuery.body, 'VALIDATION_ERROR')

    for (const pathName of ['/api/operations/watchdog.json', '/api/operations/watchdog%20']) {
      const suffix = await requestJson(baseUrl, pathName, { headers: authHeader('Admin') })
      assert.equal(suffix.response.status, 404)
    }
    const wrongMethod = await requestJson(baseUrl, '/api/operations/watchdog', {
      method: 'POST', headers: authHeader('Admin'), body: {},
    })
    assert.equal(wrongMethod.response.status, 404)
  })
})

test('watchdog diagnostics reject invalid, expired, inactive, and archived authentication', async () => {
  const invalidApp = loadAppWithMocks()
  await withTestServer(invalidApp, async (baseUrl) => {
    const invalid = await requestJson(baseUrl, '/api/operations/watchdog', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    })
    assert.equal(invalid.response.status, 401)
    assertError(invalid.body, 'UNAUTHENTICATED')

    const expiredToken = jwt.sign(
      { username: 'admin', role: 'Admin' },
      JWT_SECRET,
      { subject: userId, expiresIn: -1 },
    )
    const expired = await requestJson(baseUrl, '/api/operations/watchdog', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    })
    assert.equal(expired.response.status, 401)
    assertError(expired.body, 'UNAUTHENTICATED')
  })

  for (const [status, code] of [['Inactive', 'ACCOUNT_INACTIVE'], ['Archived', 'ACCOUNT_ARCHIVED']]) {
    const error = createHttpError(403, code, `Account is ${status.toLowerCase()}.`)
    const app = loadAppWithMocks({
      'src/modules/auth/auth.service.js': {
        login: async () => ({}),
        getAuthenticatedUser: async () => { throw error },
      },
    })
    await withTestServer(app, async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/operations/watchdog', {
        headers: authHeader('Admin'),
      })
      assert.equal(result.response.status, 403)
      assertError(result.body, code)
    })
  }
})

test('POST /api/auth/login succeeds with valid credentials', async () => {
  const app = loadAppWithMocks({
    'src/modules/auth/auth.service.js': {
      login: async ({ username, password }) => {
        assert.equal(username, 'admin')
        assert.equal(password, 'password123')
        return {
          token: 'test-token',
          user: {
            id: userId,
            name: 'admin',
            username: 'admin',
            email: 'admin@petrohydropipe.local',
            role: 'Admin',
            mustChangePassword: true,
          },
        }
      },
      getAuthenticatedUser: async () => ({}),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'password123' },
    })

    assert.equal(response.status, 200)
    assert.equal(body.token, 'test-token')
    assert.equal(body.user.role, 'Admin')
  })
})

test('POST /api/auth/login rejects invalid credentials and missing fields', async () => {
  const app = loadAppWithMocks({
    'src/modules/auth/auth.service.js': {
      login: async () => {
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.')
      },
      getAuthenticatedUser: async () => ({}),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const invalidLogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'wrongpass' },
    })

    assert.equal(invalidLogin.response.status, 401)
    assertError(invalidLogin.body, 'INVALID_CREDENTIALS')

    const missingFields = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: {},
    })

    assert.equal(missingFields.response.status, 400)
    assertError(missingFields.body, 'VALIDATION_ERROR')
  })
})

test('POST /api/auth/login returns 429 after repeated attempts', async () => {
  const app = loadAppWithMocks({
    'src/modules/auth/auth.service.js': {
      login: async () => {
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.')
      },
      getAuthenticatedUser: async () => ({}),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    let latestResult = null

    for (let attempt = 0; attempt < 11; attempt += 1) {
      latestResult = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: 'wrongpass' },
      })
    }

    assert.equal(latestResult.response.status, 429)
    assertError(latestResult.body, 'RATE_LIMITED')
  })
})

test('protected users routes return 401 without token and 403 for non-admin role', async () => {
  const app = loadAppWithMocks({
    'src/modules/users/users.service.js': {
      listUsers: async () => [],
      listRoles: async () => [],
      createUser: async () => ({}),
      updateUserStatus: async () => ({}),
      archiveUser: async () => ({}),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const noToken = await requestJson(baseUrl, '/api/users')

    assert.equal(noToken.response.status, 401)
    assertError(noToken.body, 'UNAUTHENTICATED')

    const blockedRole = await requestJson(baseUrl, '/api/users', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(blockedRole.response.status, 403)
    assertError(blockedRole.body, 'FORBIDDEN')
  })
})

test('protected routes use current database user state instead of trusting stale JWT claims', async () => {
  const app = loadAppWithMocks({
    'src/modules/auth/auth.service.js': {
      login: async () => ({}),
      getAuthenticatedUser: async (tokenPayload) => ({
        id: tokenPayload.sub,
        name: tokenPayload.username,
        username: tokenPayload.username,
        role: 'Production Supervisor',
        mustChangePassword: false,
      }),
    },
    'src/modules/users/users.service.js': {
      listUsers: async () => [],
      listRoles: async () => [],
      createUser: async () => ({}),
      updateUserStatus: async () => ({}),
      archiveUser: async () => ({}),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, '/api/users', {
      headers: authHeader('Admin'),
    })

    assert.equal(result.response.status, 403)
    assertError(result.body, 'FORBIDDEN')
  })
})

test('protected routes block inactive and archived current users', async () => {
  const usersServiceMock = {
    listUsers: async () => [],
    listRoles: async () => [],
    createUser: async () => ({}),
    updateUserStatus: async () => ({}),
    archiveUser: async () => ({}),
  }

  for (const blockedError of [
    createHttpError(403, 'ACCOUNT_INACTIVE', 'User account is inactive.'),
    createHttpError(403, 'ACCOUNT_ARCHIVED', 'User account is archived.'),
  ]) {
    const app = loadAppWithMocks({
      'src/modules/auth/auth.service.js': {
        login: async () => ({}),
        getAuthenticatedUser: async () => {
          throw blockedError
        },
      },
      'src/modules/users/users.service.js': usersServiceMock,
    })

    await withTestServer(app, async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/users', {
        headers: authHeader('Admin'),
      })

      assert.equal(result.response.status, 403)
      assertError(result.body, blockedError.code)
    })
  }
})

test('app middleware applies JSON body limit and CORS allowlist behavior', async () => {
  const app = loadAppWithMocks()

  await withTestServer(app, async (baseUrl) => {
    const oversized = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { payload: 'x'.repeat(120000) },
    })

    assert.equal(oversized.response.status, 413)

    const allowedOrigin = await requestJson(baseUrl, '/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    })

    assert.equal(allowedOrigin.response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
    assert.equal(allowedOrigin.response.headers.get('access-control-expose-headers'), 'Retry-After')

    const blockedOrigin = await requestJson(baseUrl, '/api/health', {
      headers: { Origin: 'https://not-allowed.example.com' },
    })

    assert.equal(blockedOrigin.response.headers.get('access-control-allow-origin'), null)
  })
})

test('admin can list, create, and archive users through mocked service', async () => {
  const app = loadAppWithMocks({
    'src/modules/users/users.service.js': {
      listUsers: async () => [{ id: userId, username: 'admin', role: 'Admin', status: 'Active' }],
      listRoles: async () => [{ id: 'role-admin', name: 'Admin' }],
      createUser: async (values) => ({
        id: '44444444-4444-4444-8444-444444444444',
        username: values.username,
        email: values.email,
        role: values.role,
        status: 'Active',
      }),
      updateUserStatus: async ({ userId: targetUserId, status }) => ({ id: targetUserId, status }),
      archiveUser: async ({ userId: targetUserId }) => ({ id: targetUserId, username: 'operator01', status: 'Inactive' }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const users = await requestJson(baseUrl, '/api/users', {
      headers: authHeader(),
    })

    assert.equal(users.response.status, 200)
    assert.equal(users.body.users.length, 1)

    const created = await requestJson(baseUrl, '/api/users', {
      method: 'POST',
      headers: authHeader(),
      body: {
        name: 'Operator One',
        username: 'operator01',
        email: 'operator01@petrohydropipe.local',
        role: 'Production Supervisor',
        password: 'temporary123',
      },
    })

    assert.equal(created.response.status, 201)
    assert.equal(created.body.user.username, 'operator01')

    const archived = await requestJson(baseUrl, `/api/users/${userId}/archive`, {
      method: 'PATCH',
      headers: authHeader(),
    })

    assert.equal(archived.response.status, 200)
    assert.equal(archived.body.user.status, 'Inactive')
  })
})

test('machine routes allow admin status update and block production supervisor', async () => {
  const app = loadAppWithMocks({
    'src/modules/machines/machines.service.js': {
      listMachines: async () => [{ id: machineId, machineCode: 'M-01', name: 'Spiral Mill 01', status: 'Idle' }],
      listSensorsByMachine: async () => [{ id: sensorId, sensorCode: 'S-01', status: 'Active' }],
      updateMachineStatus: async ({ machineId: targetMachineId, status }) => ({ id: targetMachineId, status }),
      updateSensorStatus: async ({ sensorId: targetSensorId, status }) => ({ id: targetSensorId, status }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const blocked = await requestJson(baseUrl, '/api/machines', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(blocked.response.status, 403)
    assertError(blocked.body, 'FORBIDDEN')

    const updated = await requestJson(baseUrl, `/api/machines/${machineId}/status`, {
      method: 'PATCH',
      headers: authHeader(),
      body: { status: 'Running' },
    })

    assert.equal(updated.response.status, 200)
    assert.equal(updated.body.machine.status, 'Running')
  })
})

test('machine settings GET supports all dashboard roles and validates machine ids', async () => {
  const settings = {
    machineId,
    timeZone: 'Asia/Manila',
    sensorThresholds: {},
    shiftSchedule: {},
    version: '1',
    updatedAt: '2026-08-22T00:00:00.000Z',
    updatedBy: null,
  }
  const app = loadAppWithMocks({
    'src/modules/settings/settings.service.js': {
      getMachineSettings: async (targetMachineId) => {
        assert.equal(targetMachineId, machineId)
        return settings
      },
      updateMachineSettings: async () => settings,
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const roles = [
      'Admin',
      'Operation Manager',
      'Asst. Operation Manager',
      'Engineering Supervisor',
      'Production Supervisor',
    ]

    for (const role of roles) {
      const result = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
        headers: authHeader(role),
      })
      assert.equal(result.response.status, 200, role)
      assert.deepEqual(result.body, { settings })
    }

    const unauthenticated = await requestJson(baseUrl, `/api/machines/${machineId}/settings`)
    assert.equal(unauthenticated.response.status, 401)
    assertError(unauthenticated.body, 'UNAUTHENTICATED')

    const invalid = await requestJson(baseUrl, '/api/machines/not-a-uuid/settings', {
      headers: authHeader(),
    })
    assert.equal(invalid.response.status, 400)
    assertError(invalid.body, 'VALIDATION_ERROR')
  })
})

test('machine settings PATCH is Admin-only and forwards validated partial updates', async () => {
  const calls = []
  const settings = {
    machineId,
    timeZone: 'Asia/Manila',
    sensorThresholds: {},
    shiftSchedule: {},
    version: '2',
    updatedAt: '2026-08-22T00:01:00.000Z',
    updatedBy: userId,
  }
  const app = loadAppWithMocks({
    'src/modules/settings/settings.service.js': {
      getMachineSettings: async () => settings,
      updateMachineSettings: async (values) => {
        calls.push(values)
        return settings
      },
    },
  })
  const sensorThreshold = {
    absenceDetectionEnabled: false,
    triggerSeconds: 60,
    recoverySeconds: null,
  }

  await withTestServer(app, async (baseUrl) => {
    const forbidden = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
      method: 'PATCH',
      headers: authHeader('Engineering Supervisor'),
      body: { expectedVersion: '1', sensorThresholds: { 'S-03': sensorThreshold } },
    })
    assert.equal(forbidden.response.status, 403)
    assertError(forbidden.body, 'FORBIDDEN')

    const updated = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { expectedVersion: '1', sensorThresholds: { 'S-03': sensorThreshold } },
    })
    assert.equal(updated.response.status, 200)
    assert.deepEqual(updated.body, { settings })
    assert.deepEqual(calls, [{
      machineId,
      expectedVersion: '1',
      sensorThresholds: { 'S-03': sensorThreshold },
      shiftSchedule: undefined,
      actorUserId: userId,
    }])

    const invalid = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { expectedVersion: '1', sensorThresholds: { 'S-99': sensorThreshold } },
    })
    assert.equal(invalid.response.status, 400)
    assertError(invalid.body, 'VALIDATION_ERROR')
    assert.equal(calls.length, 1)
  })
})

test('machine settings API preserves conflicts and masks internal failures', async () => {
  const conflict = createHttpError(409, 'SETTINGS_VERSION_CONFLICT', 'Machine settings were updated by another request.')
  const conflictApp = loadAppWithMocks({
    'src/modules/settings/settings.service.js': {
      getMachineSettings: async () => ({}),
      updateMachineSettings: async () => { throw conflict },
    },
  })
  const body = {
    expectedVersion: '1',
    sensorThresholds: {
      'S-03': {
        absenceDetectionEnabled: false,
        triggerSeconds: 60,
        recoverySeconds: null,
      },
    },
  }

  await withTestServer(conflictApp, async (baseUrl) => {
    const result = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
      method: 'PATCH',
      headers: authHeader(),
      body,
    })
    assert.equal(result.response.status, 409)
    assertError(result.body, 'SETTINGS_VERSION_CONFLICT')
  })

  const failure = createHttpError(500, 'SETTINGS_QUERY_FAILED', 'private database failure')
  const failureApp = loadAppWithMocks({
    'src/modules/settings/settings.service.js': {
      getMachineSettings: async () => { throw failure },
      updateMachineSettings: async () => ({}),
    },
  })

  await withTestServer(failureApp, async (baseUrl) => {
    const result = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
      headers: authHeader(),
    })
    assert.equal(result.response.status, 500)
    assertError(result.body, 'SETTINGS_QUERY_FAILED')
    assert.equal(result.body.error.message, 'Unexpected server error.')
    assert.doesNotMatch(JSON.stringify(result.body), /private database failure/)
  })
})

test('dashboard overview route returns backend summary for allowed roles', async () => {
  const app = loadAppWithMocks({
    'src/modules/dashboard/dashboard.service.js': {
      getOverview: async ({ trendMode }) => ({
        alerts: [],
        summary: [{ id: 'pipes', label: 'Total Pipes Today', value: '5 pcs', helper: 'From S-05 output cutting events' }],
        productionAnalytics: {
          day: { currentTotal: 5, previousTotal: 4, targetTotal: 1400, unit: 'pcs', points: [] },
          week: { currentTotal: 5, previousTotal: 4, targetTotal: 7600, unit: 'pcs', points: [] },
          month: { currentTotal: 5, previousTotal: 4, targetTotal: 30000, unit: 'pcs', points: [] },
        },
        downtimeImpact: { thresholdMinutes: 30, points: [{ label: trendMode || 'week', minutes: 0 }] },
        availability: [{ machineId: 'Spiral Mill 01', percent: 100 }],
        unreadAlerts: 0,
      }),
      getDowntimeImpact: async ({ trendMode }) => ({
        thresholdMinutes: 30,
        points: [{ label: trendMode || 'week', minutes: 12, estimatedLoss: 28, cause: 'Corrective Maintenance' }],
      }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, '/api/dashboard/overview?trendMode=week', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(result.response.status, 200)
    assert.equal(result.body.summary[0].id, 'pipes')

    const chart = await requestJson(baseUrl, '/api/dashboard/downtime-impact?trendMode=today', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(chart.response.status, 200)
    assert.equal(chart.body.downtimeImpact.points[0].label, 'today')

    const noToken = await requestJson(baseUrl, '/api/dashboard/downtime-impact?trendMode=today')

    assert.equal(noToken.response.status, 401)
    assertError(noToken.body, 'UNAUTHENTICATED')

    const invalid = await requestJson(baseUrl, '/api/dashboard/downtime-impact?trendMode=year', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(invalid.response.status, 400)
    assertError(invalid.body, 'VALIDATION_ERROR')
  })
})

test('downtime routes list and update records', async () => {
  const downtimeId = '55555555-5555-4555-8555-555555555555'
  const app = loadAppWithMocks({
    'src/modules/downtime/downtime.service.js': {
      listDowntime: async () => ({
        records: [{ id: downtimeId, status: 'Open', cause: 'Pending Cause Review' }],
        summary: { open: 1, resolved: 0, minutes: 10, loss: 23 },
      }),
      updateDowntime: async ({ downtimeId: targetId, values }) => ({
        record: { id: targetId, status: values.status || 'Open', cause: values.cause || 'Pending Cause Review' },
      }),
      subscribeToDowntimeEvents: (listener) => {
        setImmediate(() => {
          listener({
            type: 'downtime.created',
            downtime: { id: downtimeId, status: 'Open', sensorCode: 'S-03' },
          })
        })

        return () => {}
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const list = await requestJson(baseUrl, '/api/downtime?status=Open', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(list.response.status, 200)
    assert.equal(list.body.records.length, 1)

    const controller = new AbortController()
    const stream = await fetch(`${baseUrl}/api/downtime/stream`, {
      headers: authHeader('Production Supervisor'),
      signal: controller.signal,
    })
    const reader = stream.body.getReader()
    const { value } = await reader.read()
    controller.abort()

    assert.equal(stream.status, 200)
    assert.match(Buffer.from(value).toString('utf8'), /event: heartbeat|event: downtime\.created/)

    const updated = await requestJson(baseUrl, `/api/downtime/${downtimeId}`, {
      method: 'PATCH',
      headers: authHeader('Production Supervisor'),
      body: { status: 'Resolved' },
    })

    assert.equal(updated.response.status, 200)
    assert.equal(updated.body.record.status, 'Resolved')

    const clearNotes = await requestJson(baseUrl, `/api/downtime/${downtimeId}`, {
      method: 'PATCH',
      headers: authHeader('Production Supervisor'),
      body: { notes: '' },
    })
    assert.equal(clearNotes.response.status, 200)

    const reopen = await requestJson(baseUrl, `/api/downtime/${downtimeId}`, {
      method: 'PATCH',
      headers: authHeader('Production Supervisor'),
      body: { status: 'Open' },
    })
    assert.equal(reopen.response.status, 400)

    const assistantEdit = await requestJson(baseUrl, `/api/downtime/${downtimeId}`, {
      method: 'PATCH',
      headers: authHeader('Asst. Operation Manager'),
      body: { notes: 'Unauthorized edit' },
    })
    assert.equal(assistantEdit.response.status, 403)
  })
})

test('reports summary is restricted to management roles', async () => {
  const app = loadAppWithMocks({
    'src/modules/reports/reports.service.js': {
      getSummary: async ({ type }) => ({
        reportType: type,
        summary: [{ id: 'production', label: 'Production Count', value: '5 pcs' }],
        rows: [],
      }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const blocked = await requestJson(baseUrl, '/api/reports/summary?type=daily', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(blocked.response.status, 403)
    assertError(blocked.body, 'FORBIDDEN')

    const allowed = await requestJson(baseUrl, '/api/reports/summary?type=daily', {
      headers: authHeader('Operation Manager'),
    })

    assert.equal(allowed.response.status, 200)
    assert.equal(allowed.body.report.reportType, 'daily')
  })
})

test('alert routes list, acknowledge, and protect realtime stream', async () => {
  const alertId = '77777777-7777-4777-8777-777777777777'
  const app = loadAppWithMocks({
    'src/modules/alerts/alerts.service.js': {
      listAlerts: async () => ({
        alerts: [{
          id: alertId,
          severity: 'Critical',
          status: 'Active',
          title: 'Outside Filler Wire downtime detected',
          message: 'S-04 Outside Filler Wire has no pulse.',
          revision: '1',
        }],
        snapshotRevision: '1',
      }),
      acknowledgeAlert: async ({ alertId: targetAlertId, actorUser }) => ({
        id: targetAlertId,
        severity: 'Critical',
        status: 'Acknowledged',
        title: 'Outside Filler Wire downtime detected',
        message: 'S-04 Outside Filler Wire has no pulse.',
        revision: '2',
        acknowledgedAt: '2026-06-11T00:00:00.000Z',
        acknowledgedBy: {
          id: actorUser.id,
          name: actorUser.name,
          role: actorUser.role,
        },
      }),
      subscribeToAlertEvents: (listener) => {
        setImmediate(() => {
          listener({
            type: 'alert.created',
            alert: {
              id: alertId,
              severity: 'Critical',
              status: 'Active',
              title: 'Outside Filler Wire downtime detected',
              message: 'S-04 Outside Filler Wire has no pulse.',
              revision: '1',
            },
          })
        })

        return () => {}
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const noToken = await requestJson(baseUrl, '/api/alerts')

    assert.equal(noToken.response.status, 401)
    assertError(noToken.body, 'UNAUTHENTICATED')

    const listed = await requestJson(baseUrl, '/api/alerts', {
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(listed.response.status, 200)
    assert.equal(listed.body.alerts[0].message, 'S-04 Outside Filler Wire has no pulse.')
    assert.equal(listed.body.alerts[0].revision, '1')
    assert.equal(listed.body.snapshotRevision, '1')

    const acknowledged = await requestJson(baseUrl, `/api/alerts/${alertId}/acknowledge`, {
      method: 'PATCH',
      headers: authHeader('Production Supervisor'),
    })

    assert.equal(acknowledged.response.status, 200)
    assert.equal(acknowledged.body.alert.status, 'Acknowledged')
    assert.equal(acknowledged.body.alert.revision, '2')

    const controller = new AbortController()
    const stream = await fetch(`${baseUrl}/api/alerts/stream`, {
      headers: authHeader('Production Supervisor'),
      signal: controller.signal,
    })
    const reader = stream.body.getReader()
    let streamText = ''

    for (let attempt = 0; attempt < 3 && !streamText.includes('event: alert.created'); attempt += 1) {
      const { value, done } = await reader.read()
      if (done) break
      streamText += Buffer.from(value).toString('utf8')
    }

    controller.abort()

    assert.equal(stream.status, 200)
    assert.match(streamText, /event: alert\.created/)
    assert.match(streamText, /"revision":"1"/)
  })
})

test('POST /api/iot/events rejects invalid ESP32 device authentication', async () => {
  let eventProcessingCalls = 0
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => {
        throw createHttpError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
      },
      createSensorEvent: async () => {
        eventProcessingCalls += 1
        return { id: 'event-1' }
      },
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, '/api/iot/events', {
      method: 'POST',
      headers: {
        'x-device-id': 'esp32-m01-s01',
        'x-device-key': 'wrong-device-key',
      },
      body: {
        eventId: '11111111-1111-4111-8111-111111111111',
        eventType: 'pulse',
        signal: 'active',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: { sequence: 1 },
      },
    })

    assert.equal(result.response.status, 401)
    assertError(result.body, 'DEVICE_UNAUTHORIZED')
    assert.equal(eventProcessingCalls, 0)
  })
})

test('POST /api/iot/events never returns 201 when the atomic ingestion RPC fails', async () => {
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => ({ id: sensorId, esp32_device_id: 'esp32-m01-s01' }),
      createSensorEvent: async () => {
        throw createHttpError(
          500,
          'SENSOR_EVENT_PROCESSING_FAILED',
          'Unable to process sensor event.',
        )
      },
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, '/api/iot/events', {
      method: 'POST',
      headers: {
        'x-device-id': 'esp32-m01-s01',
        'x-device-key': 'test-device-key',
      },
      body: {
        eventId: '11111111-1111-4111-8111-111111111111',
        eventType: 'fault',
        signal: 'fault',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: {},
      },
    })

    assert.equal(result.response.status, 500)
    assert.notEqual(result.response.status, 201)
    assertError(result.body, 'SENSOR_EVENT_PROCESSING_FAILED')
  })
})

test('POST /api/iot/events fails closed when authenticated device has no stable id', async () => {
  let eventProcessingCalls = 0
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => ({ esp32_device_id: 'esp32-m01-s01' }),
      createSensorEvent: async () => {
        eventProcessingCalls += 1
        return { id: 'event-1' }
      },
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const result = await requestJson(baseUrl, '/api/iot/events', {
      method: 'POST',
      headers: {
        'x-device-id': 'esp32-m01-s01',
        'x-device-key': 'test-device-key',
      },
      body: {
        eventId: '11111111-1111-4111-8111-111111111111',
        eventType: 'pulse',
        signal: 'active',
      },
    })

    assert.equal(result.response.status, 500)
    assertError(result.body, 'IOT_DEVICE_ID_MISSING')
    assert.equal(eventProcessingCalls, 0)
  })
})

test('POST /api/iot/events requires an idempotency UUID and matching signal', async () => {
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => ({ id: sensorId, esp32_device_id: 'esp32-m01-s01' }),
      createSensorEvent: async () => ({ id: 'event-1' }),
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const missingEventId = await requestJson(baseUrl, '/api/iot/events', {
      method: 'POST',
      headers: {
        'x-device-id': 'esp32-m01-s01',
        'x-device-key': 'test-device-key',
      },
      body: { eventType: 'pulse', signal: 'active' },
    })
    const mismatchedSignal = await requestJson(baseUrl, '/api/iot/events', {
      method: 'POST',
      headers: {
        'x-device-id': 'esp32-m01-s01',
        'x-device-key': 'test-device-key',
      },
      body: {
        eventId: '11111111-1111-4111-8111-111111111111',
        eventType: 'downtime',
        signal: 'active',
      },
    })

    assert.equal(missingEventId.response.status, 400)
    assert.equal(mismatchedSignal.response.status, 400)
  })
})

test('POST /api/iot/events validates device headers before authentication', async () => {
  let authenticationCalls = 0
  let eventProcessingCalls = 0
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => {
        authenticationCalls += 1
        return { id: sensorId, esp32_device_id: 'esp32-m01-s01' }
      },
      createSensorEvent: async () => {
        eventProcessingCalls += 1
        return { id: 'event-1' }
      },
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })
  const validBody = {
    eventId: '11111111-1111-4111-8111-111111111111',
    eventType: 'pulse',
    signal: 'active',
  }

  await withTestServer(app, async (baseUrl) => {
    const requests = [
      { 'x-device-key': 'test-device-key' },
      { 'x-device-id': 'ab', 'x-device-key': 'test-device-key' },
      { 'x-device-id': 'a'.repeat(65), 'x-device-key': 'test-device-key' },
      { 'x-device-id': 'bad/device', 'x-device-key': 'test-device-key' },
      { 'x-device-id': 'esp32-m01-s01' },
      { 'x-device-id': 'esp32-m01-s01', 'x-device-key': 'k'.repeat(129) },
    ]

    for (const headers of requests) {
      const result = await requestJson(baseUrl, '/api/iot/events', {
        method: 'POST',
        headers,
        body: validBody,
      })

      assert.equal(result.response.status, 400)
      assertError(result.body, 'VALIDATION_ERROR')
    }

    assert.equal(authenticationCalls, 0)
    assert.equal(eventProcessingCalls, 0)
  })
})

test('POST /api/iot/events returns 429 after repeated device events', async () => {
  let authenticationCalls = 0
  let eventProcessingCalls = 0
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => {
        authenticationCalls += 1
        return {
          id: sensorId,
          esp32_device_id: 'esp32-m01-s01',
          device_key_hash: 'must-not-reach-event-processing',
        }
      },
      createSensorEvent: async ({ sensor }) => {
        eventProcessingCalls += 1
        assert.equal(sensor.id, sensorId)
        assert.equal(sensor.device_key_hash, undefined)
        return {
          id: 'event-1',
          sensorCode: 'S-01',
          eventType: 'pulse',
          signal: 'active',
          recordedAt: '2026-06-11T00:00:00.000Z',
        }
      },
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    let latestResult = null

    for (let attempt = 0; attempt < 121; attempt += 1) {
      latestResult = await requestJson(baseUrl, '/api/iot/events', {
        method: 'POST',
        headers: {
          'x-device-id': 'esp32-m01-s01',
          'x-device-key': 'test-device-key',
        },
        body: {
          eventId: '11111111-1111-4111-8111-111111111111',
          eventType: 'pulse',
          signal: 'active',
          recordedAt: '2026-06-11T00:00:00.000Z',
          metadata: { sequence: attempt + 1 },
        },
      })
    }

    assert.equal(latestResult.response.status, 429)
    assertError(latestResult.body, 'RATE_LIMITED')
    assert.equal(latestResult.response.headers.get('ratelimit-limit'), '120')
    assert.equal(authenticationCalls, 121)
    assert.equal(eventProcessingCalls, 120)
  })
})

test('POST /api/iot/events keeps verified device rate-limit buckets independent', async () => {
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async ({ deviceId }) => ({ id: `verified-${deviceId}`, esp32_device_id: deviceId }),
      createSensorEvent: async () => ({ id: 'event-1' }),
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })
  const requestDeviceEvent = (baseUrl, deviceId) => requestJson(baseUrl, '/api/iot/events', {
    method: 'POST',
    headers: {
      'x-device-id': deviceId,
      'x-device-key': 'test-device-key',
    },
    body: {
      eventId: '11111111-1111-4111-8111-111111111111',
      eventType: 'pulse',
      signal: 'active',
    },
  })

  await withTestServer(app, async (baseUrl) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await requestDeviceEvent(baseUrl, 'esp32-m01-s01')
      assert.equal(result.response.status, 201)
    }

    const secondDevice = await requestDeviceEvent(baseUrl, 'esp32-m01-s02')
    const firstDeviceOverflow = await requestDeviceEvent(baseUrl, 'esp32-m01-s01')

    assert.equal(secondDevice.response.status, 201)
    assert.equal(firstDeviceOverflow.response.status, 429)
    assertError(firstDeviceOverflow.body, 'RATE_LIMITED')
  })
})

test('POST /api/iot/events blocks rotating untrusted device ids by source IP', async () => {
  let authenticationCalls = 0
  let eventProcessingCalls = 0
  const app = loadAppWithMocks({
    'src/modules/iot/iot.service.js': {
      authenticateDevice: async () => {
        authenticationCalls += 1
        throw createHttpError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
      },
      createSensorEvent: async () => {
        eventProcessingCalls += 1
        return { id: 'event-1' }
      },
      getLiveFeed: async () => ({ machine: null, sensors: [] }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    let latestResult = null

    for (let attempt = 0; attempt < 301; attempt += 1) {
      latestResult = await requestJson(baseUrl, '/api/iot/events', {
        method: 'POST',
        headers: {
          'x-device-id': `fake-device-${attempt}`,
          'x-device-key': 'fake-device-key',
        },
        body: {
          eventId: '11111111-1111-4111-8111-111111111111',
          eventType: 'pulse',
          signal: 'active',
        },
      })
    }

    assert.equal(latestResult.response.status, 429)
    assertError(latestResult.body, 'RATE_LIMITED')
    assert.equal(latestResult.response.headers.get('ratelimit-limit'), '300')
    assert.equal(authenticationCalls, 300)
    assert.equal(eventProcessingCalls, 0)
  })
})

test('POST /api/iot/events keeps source-IP ingress buckets independent', async () => {
  const previousIngressLimit = process.env.IOT_INGRESS_RATE_LIMIT
  process.env.IOT_INGRESS_RATE_LIMIT = '2'

  let app
  try {
    app = loadAppWithMocks({
      'src/modules/iot/iot.service.js': {
        authenticateDevice: async () => ({ id: sensorId, esp32_device_id: 'esp32-m01-s01' }),
        createSensorEvent: async () => ({ id: 'event-1' }),
        getLiveFeed: async () => ({ machine: null, sensors: [] }),
      },
    })
  } finally {
    if (previousIngressLimit === undefined) {
      delete process.env.IOT_INGRESS_RATE_LIMIT
    } else {
      process.env.IOT_INGRESS_RATE_LIMIT = previousIngressLimit
    }
  }

  const requestOptions = {
    headers: {
      'x-device-id': 'esp32-m01-s01',
      'x-device-key': 'test-device-key',
    },
    body: {
      eventId: '11111111-1111-4111-8111-111111111111',
      eventType: 'pulse',
      signal: 'active',
    },
  }

  await withTestServer(app, async (baseUrl) => {
    const first = await requestJsonFromLocalAddress(baseUrl, '/api/iot/events', {
      ...requestOptions,
      localAddress: '127.0.0.2',
    })
    const second = await requestJsonFromLocalAddress(baseUrl, '/api/iot/events', {
      ...requestOptions,
      localAddress: '127.0.0.2',
    })
    const blocked = await requestJsonFromLocalAddress(baseUrl, '/api/iot/events', {
      ...requestOptions,
      localAddress: '127.0.0.2',
    })
    const independentSource = await requestJsonFromLocalAddress(baseUrl, '/api/iot/events', {
      ...requestOptions,
      localAddress: '127.0.0.3',
    })

    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.equal(blocked.status, 429)
    assertError(blocked.body, 'RATE_LIMITED')
    assert.equal(independentSource.status, 201)
  })
})

test('audit list is admin-only and returns paginated response', async () => {
  const app = loadAppWithMocks({
    'src/modules/audit/audit.service.js': {
      listAuditLogs: async ({ page, limit }) => ({
        logs: [{ id: 'audit-1', action: 'LOGIN_SUCCESS', entityType: 'auth', createdAt: '2026-06-11T00:00:00.000Z' }],
        pagination: {
          page,
          limit,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      recordAuditLog: async () => {},
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const blocked = await requestJson(baseUrl, '/api/audit', {
      headers: authHeader('Engineering Supervisor'),
    })

    assert.equal(blocked.response.status, 403)
    assertError(blocked.body, 'FORBIDDEN')

    const allowed = await requestJson(baseUrl, '/api/audit?page=1&limit=25', {
      headers: authHeader(),
    })

    assert.equal(allowed.response.status, 200)
    assert.equal(allowed.body.logs.length, 1)
    assert.equal(allowed.body.pagination.limit, 25)
  })
})
