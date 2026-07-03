const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const bcrypt = require('bcryptjs')

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

function createFakeSupabase({ sensorRecord, eventRecord }) {
  const state = {
    sensorStatus: sensorRecord.status,
  }

  return {
    from(tableName) {
      const query = {
        tableName,
        filters: {},
        insertValue: null,
        updateValue: null,
        select() {
          return this
        },
        eq(field, value) {
          this.filters[field] = value
          return this
        },
        order() {
          return this
        },
        insert(value) {
          this.insertValue = value
          return this
        },
        update(value) {
          this.updateValue = value
          return this
        },
        async maybeSingle() {
          if (this.tableName === 'sensors' && this.filters.esp32_device_id === sensorRecord.esp32_device_id) {
            return { data: sensorRecord, error: null }
          }

          return { data: null, error: null }
        },
        async single() {
          if (this.tableName === 'sensor_events') {
            return { data: eventRecord, error: null }
          }

          return { data: null, error: null }
        },
        resolve() {
          if (this.tableName === 'sensors' && this.updateValue) {
            state.sensorStatus = this.updateValue.status
            return { error: null }
          }

          if (this.tableName === 'sensors') {
            return { data: [{ id: sensorRecord.id, status: state.sensorStatus }], error: null }
          }

          if (this.tableName === 'machines' && this.updateValue) {
            return { error: null }
          }

          return { data: null, error: null }
        },
        then(resolve, reject) {
          return Promise.resolve(this.resolve()).then(resolve, reject)
        },
      }

      return query
    },
  }
}

function loadIotService({ eventType, signal, auditLogs }) {
  clearSourceCache()
  const sensorRecord = createSensorRecord()
  const eventRecord = {
    id: `event-${eventType}`,
    event_type: eventType,
    event_value: { signal, metadata: {} },
    recorded_at: '2026-06-11T00:00:00.000Z',
  }

  mockModule('src/database/client.js', {
    getSupabaseClient: () => createFakeSupabase({ sensorRecord, eventRecord }),
  })
  mockModule('src/modules/audit/audit.service.js', {
    recordAuditLog: async (entry) => {
      auditLogs.push(entry)
    },
  })
  mockModule('src/modules/alerts/alerts.service.js', {
    createOrUpdateSensorAlert: async () => null,
    resolveAlertForSource: async () => null,
  })

  return require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
}

async function createTestEvent(eventType, signal) {
  const auditLogs = []
  const iotService = loadIotService({ eventType, signal, auditLogs })
  const event = await iotService.createSensorEvent({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
    payload: {
      eventType,
      signal,
      recordedAt: '2026-06-11T00:00:00.000Z',
      metadata: {},
    },
  })

  return { auditLogs, event }
}

test('pulse and idle sensor events do not create IOT_EVENT_RECEIVED audit rows', async () => {
  const pulseResult = await createTestEvent('pulse', 'active')
  const idleResult = await createTestEvent('idle', 'idle')

  assert.equal(pulseResult.event.eventType, 'pulse')
  assert.equal(idleResult.event.eventType, 'idle')
  assert.equal(
    pulseResult.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'),
    false,
  )
  assert.equal(
    idleResult.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'),
    false,
  )
})

test('important sensor events still create IOT_EVENT_RECEIVED audit rows', async () => {
  const downtimeResult = await createTestEvent('downtime', 'no_pulse')
  const recoveredResult = await createTestEvent('recovered', 'active')

  assert.equal(
    downtimeResult.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED' && entry.metadata.eventType === 'downtime'),
    true,
  )
  assert.equal(
    recoveredResult.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED' && entry.metadata.eventType === 'recovered'),
    true,
  )
})
