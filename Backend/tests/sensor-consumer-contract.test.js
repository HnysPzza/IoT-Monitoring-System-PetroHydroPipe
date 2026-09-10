const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const scenarios = require('./fixtures/sensor-consumer-scenarios.json')
const registry = require('../src/shared/sensor-registry.json')
const sourceRoot = path.resolve(__dirname, '../src')
const asOf = '2026-09-10T02:10:00.000Z'

function mockModule(relativePath, exports) {
  const filename = require.resolve(path.join(sourceRoot, relativePath))
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

for (const scenario of scenarios) {
  test(`${scenario.name}: live, overview, downtime, Analytics and Reports agree on ownership and totals`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(asOf) })
    for (const filename of Object.keys(require.cache)) {
      if (filename.startsWith(sourceRoot)) delete require.cache[filename]
    }
    const machine = {
      id: '11111111-1111-4111-8111-111111111111', machine_code: 'M-01', name: 'Spiral Mill 01',
      status: scenario.machineStatus, location: null, updated_at: asOf,
    }
    const sensors = registry.sensors.map((sensor, index) => ({
      id: `22222222-2222-4222-8222-22222222222${index}`, sensor_code: sensor.code, label: sensor.label,
      esp32_device_id: `esp32-${sensor.code}`, status: scenario.faultCodes.includes(sensor.code) ? 'Fault' : 'Active',
      updated_at: asOf, latest_event: null,
      watchdog: { connectivity_state: scenario.offlineCode === sensor.code ? 'offline' : 'online',
        detection_state: scenario.detection[index], last_evaluated_at: asOf,
        last_heartbeat_received_at: asOf, last_activity_received_at: asOf },
    }))
    const records = scenario.downtime || scenario.recovered ? [{
      id: '33333333-3333-4333-8333-333333333333', machine_id: machine.id, sensor_id: sensors[2].id,
      started_at: '2026-09-10T02:00:00.000Z', ended_at: scenario.recovered ? '2026-09-10T02:05:00.000Z' : null,
      duration_seconds: scenario.recovered ? 300 : null, status: scenario.recovered ? 'Resolved' : 'Open',
      cause: 'Pending Cause Review', notes: '', sensors: { sensor_code: 'S-03', label: sensors[2].label },
      machines: { name: machine.name },
    }] : []
    const settingsHistory = [{ machine_id: machine.id, version: '1', effective_from: null, effective_to: null,
      shift_schedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 } }]
    const client = {
      from(table) {
        assert.ok(['machines', 'sensors', 'downtime_events'].includes(table), `Unexpected table ${table}`)
        const data = table === 'machines' ? [machine] : table === 'sensors' ? sensors : records
        const query = {
          select() { return this }, eq() { return this }, order() { return this },
          lt() { return this }, or() { return this }, range() { return this },
          maybeSingle: async () => ({ data: data[0], error: null }),
          then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject) },
        }
        return query
      },
      rpc(name) {
        assert.equal(name, 'get_machine_live_snapshot')
        return { single: async () => ({ data: { snapshot_at: asOf, machine, sensors }, error: null }) }
      },
    }
    mockModule('database/client.js', { getSupabaseClient: () => client })
    mockModule('config/env.js', { WATCHDOG_MODE: scenario.mode, WATCHDOG_TICK_INTERVAL_MS: 10000,
      WATCHDOG_EVALUATION_TIMEOUT_MS: 1000, OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE: 1 })
    mockModule('modules/settings/settingsHistory.repository.js', { getSettingsHistory: async () => settingsHistory })
    mockModule('shared/sensorEventAggregation.repository.js', { aggregateSensorEvents: async () => [] })
    mockModule('shared/outputLossBasis.js', { getOutputLossBasis: async () => ({ ratePiecesPerMinute: 1 }) })
    mockModule('modules/downtime/downtime.repository.js', {
      getOverlappingDowntime: async (machineId, window) => records.filter((row) =>
        new Date(row.started_at) < window.end && new Date(row.ended_at || asOf) > window.start),
    })

    const live = await require('../src/modules/iot/iot.service').getLiveFeed()
    const overview = await require('../src/modules/dashboard/dashboard.service').getOverview({ date: '2026-09-10' })
    const downtime = await require('../src/modules/downtime/downtime.service').listDowntime({ date: '2026-09-10' })
    const analytics = await require('../src/modules/analytics/analytics.service').getAnalytics({ startDate: '2026-09-10', endDate: '2026-09-10' })
    const report = await require('../src/modules/reports/reports.service').getSummary({ type: 'daily', date: '2026-09-10' })
    const count = scenario.downtime || scenario.recovered ? 1 : 0
    const minutes = scenario.recovered ? 5 : scenario.downtime ? 10 : 0
    assert.equal(live.machine.status, scenario.machineStatus)
    assert.deepEqual(live.sensors.map((sensor) => sensor.status), scenario.statuses)
    assert.equal(overview.summary.find((item) => item.id === 'events').value, String(count))
    assert.equal(overview.summary.find((item) => item.id === 'minutes').value, `${minutes} min`)
    assert.equal(downtime.pagination.total, count)
    assert.equal(downtime.summary.minutes, minutes)
    assert.equal(downtime.summary.open, scenario.downtime ? 1 : 0)
    assert.equal(analytics.selected.summary.downtimeEventCount, count)
    assert.equal(analytics.selected.summary.downtimeMinutes, minutes)
    assert.equal(report.summary.find((item) => item.id === 'events').value, String(count))
    assert.equal(report.metrics.durationMinutes, minutes)
    assert.ok(downtime.records.every((row) => row.sensor === 'S-03'))
    assert.ok(report.rows.every((row) => row.sensor === 'S-03'))
    assert.equal(analytics.selected.downtimeSensors.find((row) => row.sensorCode === 'S-03').eventCount, count)
    assert.ok(analytics.selected.downtimeSensors.filter((row) => row.sensorCode !== 'S-03')
      .every((row) => row.eventCount === 0 && row.durationMinutes === 0))
  })
}
