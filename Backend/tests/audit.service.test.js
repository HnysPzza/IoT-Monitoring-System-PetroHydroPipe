const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function loadAuditService(calls, tableResponses = {}, logs = []) {
  const clientPath = path.join(backendRoot, 'src', 'database', 'client.js')
  const loggerPath = path.join(backendRoot, 'src', 'utils', 'logger.js')
  const servicePath = path.join(backendRoot, 'src', 'modules', 'audit', 'audit.service.js')
  delete require.cache[require.resolve(servicePath)]
  require.cache[require.resolve(loggerPath)] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      error: (code, metadata) => logs.push({ code, metadata }),
      info: () => { },
      warn: () => { },
    },
  }
  require.cache[require.resolve(clientPath)] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      getSupabaseClient: () => ({
        from(table) {
          const query = {
            select() { return this },
            order() { return this },
            range() { return this },
            insert(payload) {
              calls.push({ operation: 'insert', table, payload })
              return Promise.resolve(tableResponses[table] || { data: null, error: null })
            },
            eq(field, value) { calls.push({ operation: 'eq', field, value }); return this },
            in(field, values) { calls.push({ operation: 'in', field, values }); return this },
            gte(field, value) { calls.push({ operation: 'gte', field, value }); return this },
            lt(field, value) { calls.push({ operation: 'lt', field, value }); return this },
            then(resolve, reject) {
              return Promise.resolve(tableResponses[table] || { data: [], count: 0, error: null }).then(resolve, reject)
            },
          }
          return query
        },
      }),
    },
  }

  return require(servicePath)
}

test('audit date filters use Manila business-day boundaries', async () => {
  const calls = []
  const service = loadAuditService(calls)

  await service.listAuditLogs({ dateFrom: '2026-07-13', dateTo: '2026-07-13' })

  assert.deepEqual(calls, [
    { operation: 'gte', field: 'created_at', value: '2026-07-12T16:00:00.000Z' },
    { operation: 'lt', field: 'created_at', value: '2026-07-13T16:00:00.000Z' },
  ])
})

test('audit user records include the affected username', async () => {
  const calls = []
  const service = loadAuditService(calls, {
    audit_logs: {
      data: [{
        id: 'audit-1',
        user_id: 'actor-1',
        action: 'USER_INVITED',
        entity_type: 'user',
        entity_id: 'target-1',
        metadata: {},
        created_at: '2026-07-13T00:00:00.000Z',
        users: { id: 'actor-1', username: 'admin', name: 'Admin', roles: { name: 'Admin' } },
      }],
      count: 1,
      error: null,
    },
    users: { data: [{ id: 'target-1', username: 'operator01' }], error: null },
  })

  const result = await service.listAuditLogs()

  assert.deepEqual(result.logs[0].targetUser, { username: 'operator01' })
  assert.deepEqual(calls, [{ operation: 'in', field: 'id', values: ['target-1'] }])
})

test('recordAuditLog logs AUDIT_WRITE_FAILED and throws 500 instead of swallowing insert errors', async () => {
  const calls = []
  const logs = []
  const service = loadAuditService(calls, {
    audit_logs: {
      data: null,
      error: { message: 'audit table unavailable' },
    },
  }, logs)

  await assert.rejects(
    () => service.recordAuditLog({
      userId: 'actor-1',
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: 'target-1',
      metadata: { role: 'Admin' },
    }),
    { code: 'AUDIT_WRITE_FAILED', status: 500 },
  )

  assert.deepEqual(logs, [{
    code: 'AUDIT_WRITE_FAILED',
    metadata: {
      action: 'USER_UPDATED',
      entityType: 'user',
      error: 'audit table unavailable',
    },
  }])
})

test('listAuditLogs formats and sanitizes PRODUCTION_SPEC_UPDATED metadata', async () => {
  const calls = []
  const service = loadAuditService(calls, {
    audit_logs: {
      data: [{
        id: 'audit-spec-1',
        user_id: 'user-supervisor',
        action: 'PRODUCTION_SPEC_UPDATED',
        entity_type: 'sensor_event',
        entity_id: 'event-uuid-1',
        metadata: {
          sensorCode: 'S-05',
          machineCode: 'M-01',
          recordedAt: '2026-10-30T10:00:00.000Z',
          label: '  API-5L-X52  ',
          size: '12-inch',
          diameter: '323.85',
          radius: 161.93,
          circumference: '1017.41',
          previous: {
            label: 'OLD-PIPE',
            size: '10-inch',
            diameter: '273.05',
            radius: 136.53,
            circumference: 857.82,
          },
        },
        created_at: '2026-10-30T10:05:00.000Z',
        users: { id: 'user-supervisor', username: 'supervisor01', name: 'Supervisor', roles: { name: 'Production Supervisor' } },
      }],
      count: 1,
      error: null,
    },
  })

  const result = await service.listAuditLogs({ action: 'PRODUCTION_SPEC_UPDATED' })

  assert.equal(result.logs.length, 1)
  const log = result.logs[0]
  assert.equal(log.action, 'PRODUCTION_SPEC_UPDATED')
  assert.equal(log.entityType, 'sensor_event')
  assert.equal(log.entityId, 'event-uuid-1')
  assert.equal(log.actor.username, 'supervisor01')
  assert.equal(log.actor.role, 'Production Supervisor')
  assert.deepEqual(log.metadata, {
    sensorCode: 'S-05',
    machineCode: 'M-01',
    recordedAt: '2026-10-30T10:00:00.000Z',
    label: 'API-5L-X52',
    size: '12-inch',
    diameter: 323.85,
    radius: 161.93,
    circumference: 1017.41,
    previous: {
      label: 'OLD-PIPE',
      size: '10-inch',
      diameter: 273.05,
      radius: 136.53,
      circumference: 857.82,
    },
  })
  assert.ok(calls.some((c) => c.operation === 'eq' && c.field === 'action' && c.value === 'PRODUCTION_SPEC_UPDATED'))
})

test('listAuditLogs formats and sanitizes PRODUCTION_SPEC_BATCH_UPDATED metadata', async () => {
  const calls = []
  const service = loadAuditService(calls, {
    audit_logs: {
      data: [{
        id: 'audit-batch-1',
        user_id: 'user-admin',
        action: 'PRODUCTION_SPEC_BATCH_UPDATED',
        entity_type: 'sensor_event',
        entity_id: null,
        metadata: {
          sensorCode: 'S-05',
          matchedCount: '15',
          updatedCount: 12,
          onlyUnlabeled: true,
          sensorEventIds: ['uuid-1', 'uuid-2'],
          appliedSpec: {
            label: 'BATCH-PIPE',
            size: '8-inch',
            diameter: '219.08',
            radius: 109.54,
            circumference: '688.27',
          },
        },
        created_at: '2026-10-30T11:00:00.000Z',
        users: { id: 'user-admin', username: 'admin', name: 'Administrator', roles: [{ name: 'Admin' }] },
      }],
      count: 1,
      error: null,
    },
  })

  const result = await service.listAuditLogs({ action: 'PRODUCTION_SPEC_BATCH_UPDATED', entityType: 'sensor_event' })

  assert.equal(result.logs.length, 1)
  const log = result.logs[0]
  assert.equal(log.action, 'PRODUCTION_SPEC_BATCH_UPDATED')
  assert.equal(log.actor.username, 'admin')
  assert.equal(log.actor.role, 'Admin')
  assert.deepEqual(log.metadata, {
    sensorCode: 'S-05',
    matchedCount: 15,
    updatedCount: 12,
    onlyUnlabeled: true,
    sensorEventIds: ['uuid-1', 'uuid-2'],
    appliedSpec: {
      label: 'BATCH-PIPE',
      size: '8-inch',
      diameter: 219.08,
      radius: 109.54,
      circumference: 688.27,
    },
  })
  assert.ok(calls.some((c) => c.operation === 'eq' && c.field === 'action' && c.value === 'PRODUCTION_SPEC_BATCH_UPDATED'))
  assert.ok(calls.some((c) => c.operation === 'eq' && c.field === 'entity_type' && c.value === 'sensor_event'))
})

test('listAuditLogs preserves device health fault and recovery audit events intact', async () => {
  const calls = []
  const service = loadAuditService(calls, {
    audit_logs: {
      data: [
        {
          id: 'audit-fault-1',
          user_id: null,
          action: 'IOT_EVENT_RECEIVED',
          entity_type: 'sensor_event',
          entity_id: 'event-fault-1',
          metadata: {
            deviceId: 'ESP32_1',
            sensorCode: 'S-01',
            machineCode: 'M-01',
            deviceEventId: 'dev-1',
            eventType: 'fault',
            signal: 'fault',
            recordedAt: '2026-10-30T09:00:00.000Z',
            stale: false,
            stateApplied: true,
          },
          created_at: '2026-10-30T09:00:01.000Z',
          users: null,
        },
        {
          id: 'audit-rec-1',
          user_id: null,
          action: 'IOT_EVENT_RECEIVED',
          entity_type: 'sensor_event',
          entity_id: 'event-rec-1',
          metadata: {
            deviceId: 'ESP32_1',
            sensorCode: 'S-01',
            machineCode: 'M-01',
            deviceEventId: 'dev-2',
            eventType: 'recovered',
            signal: 'active',
            recordedAt: '2026-10-30T09:10:00.000Z',
            stale: false,
            stateApplied: true,
          },
          created_at: '2026-10-30T09:10:01.000Z',
          users: null,
        },
        {
          id: 'audit-watchdog-1',
          user_id: null,
          action: 'WATCHDOG_DOWNTIME_CREATED',
          entity_type: 'downtime',
          entity_id: 'dt-1',
          metadata: {
            sensorCode: 'S-03',
            ownerSensorCode: 'S-03',
            deviceEventId: 'dev-3',
          },
          created_at: '2026-10-30T09:15:00.000Z',
          users: null,
        },
      ],
      count: 3,
      error: null,
    },
  })

  const result = await service.listAuditLogs()

  assert.equal(result.logs.length, 3)
  assert.equal(result.logs[0].action, 'IOT_EVENT_RECEIVED')
  assert.equal(result.logs[0].metadata.eventType, 'fault')
  assert.equal(result.logs[0].metadata.sensorCode, 'S-01')
  assert.equal(result.logs[0].metadata.signal, 'fault')
  assert.equal(result.logs[1].action, 'IOT_EVENT_RECEIVED')
  assert.equal(result.logs[1].metadata.eventType, 'recovered')
  assert.equal(result.logs[1].metadata.signal, 'active')
  assert.equal(result.logs[2].action, 'WATCHDOG_DOWNTIME_CREATED')
  assert.equal(result.logs[2].metadata.ownerSensorCode, 'S-03')
})

test('listAuditLogs excludes legacy S-05 pulse events and recordAuditLog ignores pulse writes', async () => {
  const calls = []
  const service = loadAuditService(calls, {
    audit_logs: {
      data: [
        {
          id: 'audit-pulse-legacy',
          user_id: null,
          action: 'IOT_EVENT_RECEIVED',
          entity_type: 'sensor_event',
          entity_id: 'event-pulse-1',
          metadata: {
            sensorCode: 'S-05',
            eventType: 'pulse',
            signal: 'active',
          },
          created_at: '2026-10-30T08:00:00.000Z',
          users: null,
        },
        {
          id: 'audit-health-valid',
          user_id: null,
          action: 'IOT_EVENT_RECEIVED',
          entity_type: 'sensor_event',
          entity_id: 'event-fault-2',
          metadata: {
            sensorCode: 'S-05',
            eventType: 'fault',
            signal: 'fault',
          },
          created_at: '2026-10-30T08:05:00.000Z',
          users: null,
        },
      ],
      count: 2,
      error: null,
    },
  })

  const result = await service.listAuditLogs()
  assert.equal(result.logs.length, 1)
  assert.equal(result.logs[0].id, 'audit-health-valid')
  assert.equal(result.logs[0].metadata.eventType, 'fault')

  // recordAuditLog must not write S-05 pulse telemetry.
  await service.recordAuditLog({
    action: 'IOT_EVENT_RECEIVED',
    entityType: 'sensor_event',
    metadata: { sensorCode: 'S-05', eventType: 'pulse' },
  })
  const pulseInserts = calls.filter((c) => c.operation === 'insert' && c.payload?.metadata?.eventType === 'pulse')
  assert.equal(pulseInserts.length, 0)
})

test('recordAuditLog sanitizes PRODUCTION_SPEC_UPDATED before database insert', async () => {
  const calls = []
  const service = loadAuditService(calls)

  await service.recordAuditLog({
    userId: 'user-1',
    action: 'PRODUCTION_SPEC_UPDATED',
    entityType: 'sensor_event',
    entityId: 'evt-1',
    metadata: {
      sensorCode: 'S-05',
      machineCode: 'M-01',
      recordedAt: '2026-10-30T12:00:00.000Z',
      label: '  Spec Label  ',
      size: '10-in',
      diameter: '273.05',
      radius: '136.53',
      circumference: '857.82',
      previous: null,
    },
  })

  const insertCall = calls.find((c) => c.operation === 'insert' && c.table === 'audit_logs')
  assert.ok(insertCall)
  assert.deepEqual(insertCall.payload.metadata, {
    sensorCode: 'S-05',
    machineCode: 'M-01',
    recordedAt: '2026-10-30T12:00:00.000Z',
    label: 'Spec Label',
    size: '10-in',
    diameter: 273.05,
    radius: 136.53,
    circumference: 857.82,
    previous: null,
  })
})

test('recordAuditLog sanitizes PRODUCTION_SPEC_BATCH_UPDATED before database insert', async () => {
  const calls = []
  const service = loadAuditService(calls)

  await service.recordAuditLog({
    userId: 'user-admin',
    action: 'PRODUCTION_SPEC_BATCH_UPDATED',
    entityType: 'sensor_event',
    entityId: null,
    metadata: {
      sensorCode: 'S-05',
      machineCode: 'M-01',
      matchedCount: '10',
      updatedCount: '8',
      onlyUnlabeled: true,
      sensorEventIds: ['uuid-1', null, '   ', 'uuid-2'],
      appliedSpec: {
        label: '  BATCH-SPEC  ',
        size: '12-inch',
        diameter: '323.85',
        radius: '161.93',
        circumference: '1017.41',
      },
    },
  })

  const insertCall = calls.find((c) => c.operation === 'insert' && c.table === 'audit_logs')
  assert.ok(insertCall)
  assert.deepEqual(insertCall.payload.metadata, {
    sensorCode: 'S-05',
    machineCode: 'M-01',
    matchedCount: 10,
    updatedCount: 8,
    onlyUnlabeled: true,
    sensorEventIds: ['uuid-1', 'uuid-2'],
    appliedSpec: {
      label: 'BATCH-SPEC',
      size: '12-inch',
      diameter: 323.85,
      radius: 161.93,
      circumference: 1017.41,
    },
  })
})

test('sanitizeAuditMetadata handles malformed, null, and non-numeric fields safely', () => {
  const service = loadAuditService([])

  assert.deepEqual(service.sanitizeAuditMetadata('PRODUCTION_SPEC_UPDATED', null), {})
  assert.deepEqual(service.sanitizeAuditMetadata('PRODUCTION_SPEC_UPDATED', undefined), {})
  assert.deepEqual(service.sanitizeAuditMetadata('PRODUCTION_SPEC_UPDATED', 'invalid'), {})
  assert.deepEqual(service.sanitizeAuditMetadata('PRODUCTION_SPEC_UPDATED', []), {})

  const updatedMalformed = service.sanitizeAuditMetadata('PRODUCTION_SPEC_UPDATED', {
    diameter: '   ',
    radius: false,
    circumference: [],
    label: {},
    size: null,
    recordedAt: new Date('2026-10-30T10:00:00.000Z'),
    previous: [],
  })
  assert.deepEqual(updatedMalformed, {
    sensorCode: null,
    machineCode: null,
    recordedAt: '2026-10-30T10:00:00.000Z',
    label: null,
    size: null,
    diameter: null,
    radius: null,
    circumference: null,
    previous: null,
  })

  const batchMalformed = service.sanitizeAuditMetadata('PRODUCTION_SPEC_BATCH_UPDATED', {
    matchedCount: 'invalid',
    updatedCount: -5,
    onlyUnlabeled: 'truthy',
    sensorEventIds: ['uuid-1', null, '   ', 456],
    appliedSpec: null,
  })
  assert.deepEqual(batchMalformed, {
    sensorCode: 'S-05',
    matchedCount: 0,
    updatedCount: -5,
    onlyUnlabeled: true,
    sensorEventIds: ['uuid-1', '456'],
    appliedSpec: {},
  })
})

test('sanitizeAuditMetadata strips sensitive credential keys from general audit logs', () => {
  const service = loadAuditService([])

  const cleaned = service.sanitizeAuditMetadata('LOGIN_FAILED', {
    reason: 'invalid_credentials',
    password: 'super-secret-password',
    token: 'jwt-bearer-token',
    refreshToken: 'secret-refresh',
    apiKey: 'esp32-raw-key',
    username: 'operator01',
  })

  assert.deepEqual(cleaned, {
    reason: 'invalid_credentials',
    username: 'operator01',
  })
})

test('isPulseEvent accurately detects pulse variations and ignores non-pulse events', () => {
  const service = loadAuditService([])

  assert.equal(service.isPulseEvent('SENSOR_PULSE', {}), true)
  assert.equal(service.isPulseEvent('IOT_EVENT_RECEIVED', { eventType: 'pulse' }), true)
  assert.equal(service.isPulseEvent('IOT_EVENT_RECEIVED', { eventType: 'PULSE' }), true)
  assert.equal(service.isPulseEvent('IOT_EVENT_RECEIVED', { signal: 'pulse' }), true)
  assert.equal(service.isPulseEvent('IOT_EVENT_RECEIVED', { event_type: 'pulse' }), true)
  assert.equal(service.isPulseEvent('IOT_EVENT_RECEIVED', { eventType: 'fault' }), false)
  assert.equal(service.isPulseEvent('IOT_EVENT_RECEIVED', { eventType: 'recovered' }), false)
  assert.equal(service.isPulseEvent('WATCHDOG_DOWNTIME_CREATED', {}), false)
  assert.equal(service.isPulseEvent('PRODUCTION_SPEC_UPDATED', {}), false)
})



