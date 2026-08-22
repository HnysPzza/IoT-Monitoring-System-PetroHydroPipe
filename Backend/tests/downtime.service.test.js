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

function createFakeSupabase(records, calls) {
  return {
    from(tableName) {
      assert.equal(tableName, 'downtime_events')
      const query = {
        filters: {},
        fromIndex: 0,
        toIndex: Number.POSITIVE_INFINITY,
        select() { return this },
        order() { return this },
        eq(field, value) { this.filters[field] = value; return this },
        gte(field, value) { calls.push({ operation: 'gte', field, value }); return this },
        lt(field, value) { calls.push({ operation: 'lt', field, value }); return this },
        range(from, to) { this.fromIndex = from; this.toIndex = to; return this },
        matches(record) {
          return Object.entries(this.filters).every(([field, value]) => record[field] === value)
        },
        async maybeSingle() {
          return { data: records.find((record) => this.matches(record)) || null, error: null }
        },
        then(resolve, reject) {
          const matching = records.filter((record) => this.matches(record))
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

function loadDowntimeService({ records = [], auditLogs = [], calls = [], logs = [] } = {}) {
  clearSourceCache()
  const fakeSupabase = createFakeSupabase(records, calls)
  mockModule('src/database/client.js', { getSupabaseClient: () => fakeSupabase })
  mockModule('src/modules/audit/audit.service.js', {
    recordAuditLog: async (entry) => auditLogs.push(entry),
  })
  mockModule('src/utils/logger.js', {
    error: (code, metadata) => logs.push({ code, metadata }),
    info: () => {},
    warn: () => {},
  })
  return require(path.join(backendRoot, 'src', 'modules', 'downtime', 'downtime.service.js'))
}

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
    machine_id: 'machine-1',
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
  assert.equal(calls.find((call) => call.operation === 'gte').value, '2026-07-12T16:00:00.000Z')
  assert.equal(calls.find((call) => call.operation === 'lt').value, '2026-07-13T16:00:00.000Z')
  assert.match(result.records[0].displayLabel, /^S-04 12:00 AM$/)
})

test('manual sensor cause and notes are updated through the database RPC', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: 'machine-1',
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
  assert.equal(calls.find((call) => call.operation === 'rpc').functionName, 'update_downtime_record')
  assert.equal(auditLogs[0].action, 'DOWNTIME_UPDATED')
})

test('notes can be cleared without changing the cause', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: 'machine-1',
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

test('resolving is idempotent and never reopens a record', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: 'machine-1',
    sensor_id: 'sensor-3',
    started_at: '2026-06-11T00:00:00.000Z',
    cause: 'Coil Joint',
    status: 'Open',
  })]
  const service = loadDowntimeService({ records })

  const first = await service.updateDowntime({
    downtimeId: 'downtime-1',
    values: { status: 'Resolved' },
    actorUserId: 'user-1',
  })
  const second = await service.updateDowntime({
    downtimeId: 'downtime-1',
    values: { status: 'Resolved' },
    actorUserId: 'user-1',
  })

  assert.equal(first.record.status, 'Resolved')
  assert.equal(second.record.endedAt, first.record.endedAt)
  assert.equal(second.record.durationMinutes, first.record.durationMinutes)
})

test('automatic sensor downtime cause cannot be manually changed', async () => {
  const records = [attachRelations({
    id: 'downtime-1',
    machine_id: 'machine-1',
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
