const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const LOSS_BASIS = {
  source: 'configured-fallback',
  ratePiecesPerMinute: 0.05,
  windowStartAt: '2026-06-13T16:00:00.000Z',
  windowEndAt: '2026-07-13T16:00:00.000Z',
  qualifiedProductionDays: 0,
  productiveMinutes: 0,
  outputPieces: 0,
}
const SETTINGS_HISTORY = [{
  machine_id: MACHINE_ID,
  version: '1',
  shift_schedule: {
    workStart: '08:00',
    workEnd: '17:00',
    breaks: [],
    rampUpGraceMinutes: 0,
  },
  effective_from: null,
  effective_to: null,
}]

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

function attachRelations(record) {
  const isManual = record.sensor_id === 'sensor-3'
  return {
    ended_at: null,
    duration_seconds: null,
    notes: '',
    ...record,
    machines: { name: 'Spiral Mill 01' },
    sensors: {
      sensor_code: isManual ? 'S-03' : 'S-04',
      label: isManual ? 'Machine Main Sensor' : 'Outside Filler Wire',
    },
  }
}

function createFakeSupabase(records, calls, settingsHistory) {
  return {
    from(tableName) {
      assert.ok(['downtime_events', 'machine_operational_settings_history'].includes(tableName))
      const sourceRecords = tableName === 'downtime_events' ? records : settingsHistory
      const query = {
        filters: {},
        predicates: [],
        fromIndex: 0,
        toIndex: Number.POSITIVE_INFINITY,
        select() { return this },
        order() { return this },
        eq(field, value) { this.filters[field] = value; return this },
        gte(field, value) { calls.push({ operation: 'gte', field, value }); return this },
        lt(field, value) {
          calls.push({ operation: 'lt', field, value })
          this.predicates.push((record) => new Date(record[field]) < new Date(value))
          return this
        },
        or(value) {
          calls.push({ operation: 'or', value })
          if (tableName === 'downtime_events') {
            const boundary = value.split('ended_at.gt.')[1]
            assert.ok(boundary)
            this.predicates.push((record) => record.ended_at == null || new Date(record.ended_at) > new Date(boundary))
          }
          return this
        },
        range(from, to) { this.fromIndex = from; this.toIndex = to; return this },
        matches(record) {
          return Object.entries(this.filters).every(([field, value]) => record[field] === value)
            && this.predicates.every((predicate) => predicate(record))
        },
        async maybeSingle() {
          return { data: sourceRecords.find((record) => this.matches(record)) || null, error: null }
        },
        then(resolve, reject) {
          const matching = sourceRecords.filter((record) => this.matches(record))
          return Promise.resolve({
            data: matching.slice(this.fromIndex, this.toIndex + 1),
            count: matching.length,
            error: null,
          }).then(resolve, reject)
        },
      }
      return query
    },
    rpc(functionName, args) {
      calls.push({ operation: 'rpc', functionName, args })
      return {
        async single() {
          if (functionName === 'get_downtime_summary') {
            const open = records.filter((record) => record.status === 'Open').length
            const resolved = records.filter((record) => record.status === 'Resolved').length
            const minutes = records.reduce((sum, record) => sum + Number(record.duration_seconds || 0) / 60, 0)
            return {
              data: {
                open_count: open,
                resolved_count: resolved,
                total_minutes: Math.round(minutes),
                estimated_loss: Math.round(minutes * 2.3),
              },
              error: null,
            }
          }

          const record = records.find((candidate) => candidate.id === args.p_downtime_id)
          if (!record) return { data: null, error: { code: 'P0002' } }
          if (args.p_cause != null) record.cause = args.p_cause
          if (args.p_has_notes) record.notes = args.p_notes
          if (args.p_resolve && record.status === 'Open') {
            record.status = 'Resolved'
            record.ended_at = '2026-06-11T00:10:00.000Z'
            record.duration_seconds = 600
          }
          return { data: { downtime_id: record.id }, error: null }
        },
      }
    },
  }
}

function loadDowntimeService({ records = [], auditLogs = [], calls = [], logs = [], calculatedRecords = [], settingsHistory = SETTINGS_HISTORY } = {}) {
  clearSourceCache()
  const fakeSupabase = createFakeSupabase(records, calls, settingsHistory)
  mockModule('src/database/client.js', { getSupabaseClient: () => fakeSupabase })
  mockModule('src/shared/outputLossBasis.js', {
    getOutputLossBasis: async () => LOSS_BASIS,
  })
  mockModule('src/modules/audit/audit.service.js', {
    recordAuditLog: async (entry) => auditLogs.push(entry),
  })
  mockModule('src/utils/logger.js', {
    error: (code, metadata) => logs.push({ code, metadata }),
    info: () => {},
    warn: () => {},
  })
  const metrics = require('../src/shared/operationalMetrics')
  mockModule('src/shared/operationalMetrics.js', {
    ...metrics,
    calculateRecordMetrics(values) {
      calculatedRecords.push(values.record.id)
      return metrics.calculateRecordMetrics(values)
    },
  })
  return require(path.join(backendRoot, 'src', 'modules', 'downtime', 'downtime.service.js'))
}

test('list calculates detail only for the visible page while preserving whole-result totals', async () => {
  const records = Array.from({ length: 30 }, (_, index) => attachRelations({
    id: `downtime-${String(index).padStart(2, '0')}`,
    machine_id: MACHINE_ID,
    sensor_id: 'sensor-3',
    started_at: new Date(Date.UTC(2026, 6, 13, 0, index * 10)).toISOString(),
    ended_at: new Date(Date.UTC(2026, 6, 13, 0, index * 10 + 5)).toISOString(),
    cause: 'Coil Joint',
    status: 'Resolved',
  }))
  const calculatedRecords = []
  const service = loadDowntimeService({ records, calculatedRecords })
  const first = await service.listDowntime({ page: 1, limit: 10 })
  assert.deepEqual(first.summary, {
    open: 0, resolved: 30, minutes: 150, unplannedMinutes: 150, plannedExcludedMinutes: 0, loss: 7.5,
  })
  assert.equal(first.records[0].id, 'downtime-29')
  assert.equal(first.records[0].estimatedLoss, 0.25)
  assert.equal(calculatedRecords.length, 10)
  assert.deepEqual(new Set(calculatedRecords), new Set(first.records.map((record) => record.id)))
  calculatedRecords.length = 0
  const second = await service.listDowntime({ page: 2, limit: 10 })
  assert.deepEqual(second.summary, first.summary)
  assert.equal(second.records[0].id, 'downtime-19')
  assert.equal(calculatedRecords.length, 10)
  calculatedRecords.length = 0
  const outside = await service.listDowntime({ page: 4, limit: 10 })
  assert.deepEqual(outside.summary, first.summary)
  assert.deepEqual(outside.records, [])
  assert.equal(calculatedRecords.length, 0)
})

test('empty list returns empty metrics without calculating details', async () => {
  const calculatedRecords = []
  const service = loadDowntimeService({ calculatedRecords })
  const result = await service.listDowntime()
  assert.deepEqual(result.records, [])
  assert.equal(result.pagination.total, 0)
  assert.equal(result.summary.minutes, 0)
  assert.equal(result.lossEstimateBasis, null)
  assert.equal(calculatedRecords.length, 0)
})

test('tied starts keep descending IDs and union overlaps across pages', async () => {
  const records = ['a', 'c', 'b'].map((id) => attachRelations({
    id, machine_id: MACHINE_ID, sensor_id: 'sensor-3',
    started_at: '2026-07-13T00:00:00.000Z', ended_at: '2026-07-13T00:30:00.000Z',
    cause: 'Coil Joint', status: 'Resolved',
  }))
  const service = loadDowntimeService({ records })
  const first = await service.listDowntime({ page: 1, limit: 2 })
  const last = await service.listDowntime({ page: 2, limit: 2 })
  assert.deepEqual(first.records.map((record) => record.id), ['c', 'b'])
  assert.deepEqual(last.records.map((record) => record.id), ['a'])
  assert.equal(first.summary.minutes, 30)
  assert.equal(first.summary.loss, 1.5)
  assert.deepEqual(last.summary, first.summary)
})

test('paged details retain breaks, grace and effective-dated schedules', async () => {
  const changeAt = '2026-07-13T02:30:00.000Z'
  const settingsHistory = [
    { ...SETTINGS_HISTORY[0], effective_to: changeAt, shift_schedule: {
      workStart: '08:00', workEnd: '17:00', rampUpGraceMinutes: 10,
      breaks: [{ name: 'Morning', startTime: '10:00', endTime: '10:15' }],
    } },
    { ...SETTINGS_HISTORY[0], version: '2', effective_from: changeAt, shift_schedule: {
      workStart: '11:00', workEnd: '17:00', rampUpGraceMinutes: 0, breaks: [],
    } },
  ]
  const records = [
    { id: 'before', started_at: '2026-07-13T01:55:00.000Z', ended_at: changeAt },
    { id: 'after', started_at: changeAt, ended_at: '2026-07-13T03:10:00.000Z' },
  ].map((record) => attachRelations({ ...record, machine_id: MACHINE_ID, sensor_id: 'sensor-3', status: 'Resolved', cause: 'Other' }))
  const service = loadDowntimeService({ records, settingsHistory })
  const first = await service.listDowntime({ page: 1, limit: 1 })
  const second = await service.listDowntime({ page: 2, limit: 1 })
  assert.deepEqual(first.summary, { open: 0, resolved: 2, minutes: 75, unplannedMinutes: 20, plannedExcludedMinutes: 55, loss: 1 })
  assert.deepEqual(second.summary, first.summary)
  assert.equal(first.records[0].durationMinutes, 40)
  assert.equal(first.records[0].unplannedMinutes, 10)
  assert.equal(second.records[0].plannedExcludedMinutes, 25)
})

test('Manila date filters use overlap and keep status and cause filters on all pages', async () => {
  const records = [
    { id: 'crossing', started_at: '2026-07-12T15:55:00.000Z', ended_at: '2026-07-12T16:05:00.000Z' },
    { id: 'ends-at-start', started_at: '2026-07-12T15:50:00.000Z', ended_at: '2026-07-12T16:00:00.000Z' },
    { id: 'starts-at-end', started_at: '2026-07-13T16:00:00.000Z', ended_at: '2026-07-13T16:10:00.000Z' },
    { id: 'other-cause', started_at: '2026-07-13T00:00:00.000Z', ended_at: '2026-07-13T00:10:00.000Z', cause: 'Coil Joint' },
    { id: 'open', started_at: '2026-07-13T00:00:00.000Z', ended_at: null, status: 'Open' },
  ].map((record) => attachRelations({ machine_id: MACHINE_ID, sensor_id: 'sensor-3', status: 'Resolved', cause: 'Other', ...record }))
  const service = loadDowntimeService({ records })
  const result = await service.listDowntime({ date: '2026-07-13', status: 'Resolved', cause: 'Other' })
  assert.deepEqual(result.records.map((record) => record.id), ['crossing'])
  assert.equal(result.summary.minutes, 5)
  assert.equal(result.records[0].durationMinutes, 10)
  assert.equal(result.summary.loss, 0)
})

test('open and zero-length records preserve metrics with a fixed clock across pages', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-07-13T00:30:00.000Z') })
  const records = [
    { id: 'open', started_at: '2026-07-13T00:00:00.000Z', ended_at: null, status: 'Open' },
    { id: 'zero', started_at: '2026-07-13T00:30:00.000Z', ended_at: '2026-07-13T00:30:00.000Z', status: 'Resolved' },
  ].map((record) => attachRelations({ machine_id: MACHINE_ID, sensor_id: 'sensor-3', cause: 'Other', ...record }))
  const service = loadDowntimeService({ records })
  const first = await service.listDowntime({ page: 1, limit: 1 })
  const second = await service.listDowntime({ page: 2, limit: 1 })
  assert.deepEqual(first.summary, { open: 1, resolved: 1, minutes: 30, unplannedMinutes: 30, plannedExcludedMinutes: 0, loss: 1.5 })
  assert.deepEqual(second.summary, first.summary)
  assert.equal(first.records[0].estimatedLoss, 0)
  assert.equal(second.records[0].estimatedLoss, 1.5)
})

test('missing history fails closed even when the requested page is empty', async () => {
  const records = [attachRelations({ id: 'history-gap', machine_id: MACHINE_ID, sensor_id: 'sensor-3',
    started_at: '2026-07-13T00:00:00.000Z', ended_at: '2026-07-13T00:30:00.000Z', status: 'Resolved', cause: 'Other' })]
  const service = loadDowntimeService({ records, settingsHistory: [] })
  await assert.rejects(() => service.listDowntime({ page: 2, limit: 25 }), { code: 'SETTINGS_HISTORY_GAP' })
})

test('downtime publication isolates a throwing listener from healthy subscribers', () => {
  const logs = []
  const service = loadDowntimeService({ logs })
  const stopThrowing = service.subscribeToDowntimeEvents(() => {
    throw new Error('listener failed')
  })
  let delivered = null
  const stopHealthy = service.subscribeToDowntimeEvents((event) => {
    delivered = event
  })

  const published = service.publishDowntimeEvent('downtime.created', {
    id: 'downtime-1',
    status: 'Open',
  })
  stopThrowing()
  stopHealthy()

  assert.equal(published, false)
  assert.equal(delivered.type, 'downtime.created')
  assert.deepEqual(logs, [{
    code: 'DOWNTIME_SSE_PUBLISH_FAILED',
    metadata: { downtimeId: 'downtime-1', type: 'downtime.created' },
  }])
})

test('downtime list uses Manila day boundaries and returns pagination', async () => {
  const calls = []
  const records = Array.from({ length: 30 }, (_, index) => attachRelations({
    id: `downtime-${index}`,
    machine_id: MACHINE_ID,
    sensor_id: 'sensor-1',
    started_at: '2026-07-12T16:00:00.000Z',
    cause: 'Flux Refill',
    status: 'Open',
  }))
  const service = loadDowntimeService({ records, calls })

  const result = await service.listDowntime({ date: '2026-07-13', page: 2, limit: 10 })

  assert.equal(result.records.length, 10)
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 10,
    total: 30,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  })
  assert.equal(result.summary.open, 30)
  assert.equal(result.summary.loss, 27)
  assert.deepEqual(result.lossEstimateBasis, LOSS_BASIS)
  assert.equal(calls.find((call) => call.operation === 'lt').value, '2026-07-13T16:00:00.000Z')
  assert.match(calls.find((call) => call.operation === 'or').value, /ended_at\.gt\.2026-07-12T16:00:00\.000Z/)
  assert.match(result.records[0].displayLabel, /^S-04 12:00 AM$/)
})

test('manual sensor cause and notes are updated through the database RPC', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: MACHINE_ID,
    sensor_id: 'sensor-3',
    started_at: '2026-06-11T00:00:00.000Z',
    cause: 'Pending Cause Review',
    status: 'Open',
  })]
  const auditLogs = []
  const calls = []
  const service = loadDowntimeService({ records, auditLogs, calls })

  const result = await service.updateDowntime({
    downtimeId: 'downtime-1',
    values: { cause: 'Misalignment', notes: 'Operator confirmed roller tracking issue.' },
    actorUserId: 'user-1',
  })

  assert.equal(result.record.cause, 'Misalignment')
  assert.equal(result.record.notes, 'Operator confirmed roller tracking issue.')
  const rpcCall = calls.find((call) => call.operation === 'rpc')
  assert.equal(rpcCall.functionName, 'update_downtime_record')
  assert.equal(rpcCall.args.p_actor_user_id, 'user-1')
  assert.deepEqual(auditLogs, [])
})

test('notes can be cleared without changing the cause', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: MACHINE_ID,
    sensor_id: 'sensor-3',
    started_at: '2026-06-11T00:00:00.000Z',
    cause: 'Coil Joint',
    status: 'Open',
    notes: 'Remove me',
  })]
  const service = loadDowntimeService({ records })

  const result = await service.updateDowntime({
    downtimeId: 'downtime-1',
    values: { notes: '' },
    actorUserId: 'user-1',
  })

  assert.equal(result.record.notes, '')
  assert.equal(result.record.cause, 'Coil Joint')
})

test('sensor-managed downtime cannot be resolved by the service', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: MACHINE_ID,
    sensor_id: 'sensor-3',
    started_at: '2026-06-11T00:00:00.000Z',
    cause: 'Coil Joint',
    status: 'Open',
  })]
  const service = loadDowntimeService({ records })

  await assert.rejects(
    () => service.updateDowntime({
      downtimeId: 'downtime-1',
      values: { status: 'Resolved' },
      actorUserId: 'user-1',
    }),
    { code: 'DOWNTIME_SENSOR_MANAGED', status: 400 },
  )
})

test('automatic sensor downtime cause cannot be manually changed', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: MACHINE_ID,
    sensor_id: 'sensor-1',
    started_at: '2026-06-11T00:00:00.000Z',
    cause: 'Flux Refill',
    status: 'Open',
  })]
  const service = loadDowntimeService({ records })

  await assert.rejects(
    () => service.updateDowntime({
      downtimeId: 'downtime-1',
      values: { cause: 'Manual Cutting' },
      actorUserId: 'user-1',
    }),
    { code: 'DOWNTIME_CAUSE_LOCKED', status: 400 },
  )
})
