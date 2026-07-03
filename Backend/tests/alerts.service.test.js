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

function createAlertRecord(overrides = {}) {
  return {
    id: 'alert-1',
    source_type: 'sensor',
    source_id: 'sensor-1',
    severity: 'Critical',
    status: 'Active',
    title: 'Inside Filler downtime detected',
    message: 'S-04 Inside Filler has no pulse.',
    metadata: {
      eventType: 'downtime',
      signal: 'no_pulse',
    },
    created_at: '2026-06-11T00:00:00.000Z',
    acknowledged_at: null,
    resolved_at: null,
    machines: {
      id: 'machine-1',
      name: 'Spiral Mill 01',
    },
    sensors: {
      id: 'sensor-1',
      sensor_code: 'S-04',
      label: 'Inside Filler',
    },
    ...overrides,
  }
}

function createFakeSupabase(alertRecord) {
  return {
    from(tableName) {
      assert.equal(tableName, 'alerts')
      const query = {
        updateValues: null,
        filters: {},
        select() {
          return this
        },
        eq(field, value) {
          this.filters[field] = value
          return this
        },
        in(field, values) {
          this.filters[field] = values
          return this
        },
        update(values) {
          this.updateValues = values
          return this
        },
        async maybeSingle() {
          const matchesId = !this.filters.id || this.filters.id === alertRecord.id
          const matchesSource = !this.filters.source_id || this.filters.source_id === alertRecord.source_id

          return {
            data: matchesId && matchesSource ? alertRecord : null,
            error: null,
          }
        },
        async single() {
          Object.assign(alertRecord, this.updateValues || {})

          return {
            data: alertRecord,
            error: null,
          }
        },
      }

      return query
    },
  }
}

function loadAlertService({ alertRecord, auditLogs }) {
  clearSourceCache()
  mockModule('src/database/client.js', {
    getSupabaseClient: () => createFakeSupabase(alertRecord),
  })
  mockModule('src/modules/audit/audit.service.js', {
    recordAuditLog: async (entry) => {
      auditLogs.push(entry)
    },
  })

  return require(path.join(backendRoot, 'src', 'modules', 'alerts', 'alerts.service.js'))
}

test('sensor recovery keeps active alert visible until user acknowledgement', async () => {
  const auditLogs = []
  const alertRecord = createAlertRecord()
  const alertsService = loadAlertService({ alertRecord, auditLogs })
  let emittedEvent = null
  const unsubscribe = alertsService.subscribeToAlertEvents((event) => {
    emittedEvent = event
  })

  const alert = await alertsService.resolveAlertForSource({
    sourceType: 'sensor',
    sourceId: 'sensor-1',
    metadata: {
      eventId: 'event-2',
      eventType: 'recovered',
      signal: 'active',
      recordedAt: '2026-06-11T00:05:00.000Z',
    },
  })

  unsubscribe()

  assert.equal(alert.status, 'Active')
  assert.equal(alert.metadata.recoveryPending, true)
  assert.equal(alert.metadata.recoveryEventType, 'recovered')
  assert.equal(alertRecord.status, 'Active')
  assert.equal(emittedEvent.type, 'alert.updated')
  assert.equal(auditLogs.length, 0)
})

test('acknowledging a recovered active alert resolves it', async () => {
  const auditLogs = []
  const alertRecord = createAlertRecord({
    metadata: {
      eventType: 'downtime',
      signal: 'no_pulse',
      recoveryPending: true,
      recoveredAt: '2026-06-11T00:05:00.000Z',
    },
  })
  const alertsService = loadAlertService({ alertRecord, auditLogs })
  let emittedEvent = null
  const unsubscribe = alertsService.subscribeToAlertEvents((event) => {
    emittedEvent = event
  })

  const alert = await alertsService.acknowledgeAlert({
    alertId: 'alert-1',
    actorUser: {
      id: 'user-1',
      name: 'admin',
      username: 'admin',
      role: 'Admin',
    },
  })

  unsubscribe()

  assert.equal(alert.status, 'Resolved')
  assert.equal(alert.metadata.acknowledgedAfterRecovery, true)
  assert.equal(alertRecord.status, 'Resolved')
  assert.equal(alertRecord.acknowledged_by, 'user-1')
  assert.ok(alertRecord.acknowledged_at)
  assert.ok(alertRecord.resolved_at)
  assert.equal(emittedEvent.type, 'alert.resolved')
  assert.deepEqual(
    auditLogs.map((entry) => entry.action),
    ['ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED'],
  )
})
