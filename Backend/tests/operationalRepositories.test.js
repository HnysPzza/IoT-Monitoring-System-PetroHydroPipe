const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const MACHINE_ID = '11111111-1111-4111-8111-111111111111'

function clearSourceCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) delete require.cache[cacheKey]
  })
}

function mockClient(fakeSupabase) {
  const modulePath = path.join(backendRoot, 'src', 'database', 'client.js')
  require.cache[require.resolve(modulePath)] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: { getSupabaseClient: () => fakeSupabase },
  }
}

function createPagedClient(pagesByTable) {
  const queries = []
  return {
    queries,
    from(tableName) {
      const record = { tableName, filters: [], orders: [], range: null }
      queries.push(record)
      return {
        select() { return this },
        eq(column, value) { record.filters.push({ type: 'eq', column, value }); return this },
        lt(column, value) { record.filters.push({ type: 'lt', column, value }); return this },
        or(expression) { record.filters.push({ type: 'or', expression }); return this },
        order(column, options) { record.orders.push({ column, options }); return this },
        range(from, to) {
          record.range = { from, to }
          const rows = pagesByTable[tableName] || []
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        },
      }
    },
  }
}

test('downtime repository uses overlap semantics and deterministic pagination beyond 500 rows', async () => {
  clearSourceCache()
  const downtime = Array.from({ length: 501 }, (_, index) => ({
    id: String(index).padStart(3, '0'),
    machine_id: MACHINE_ID,
    started_at: '2026-08-01T00:00:00.000Z',
    ended_at: '2026-08-01T01:00:00.000Z',
  }))
  const fakeSupabase = createPagedClient({ downtime_events: downtime })
  mockClient(fakeSupabase)
  const { getOverlappingDowntime } = require('../src/modules/downtime/downtime.repository')
  const window = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-02T00:00:00Z') }

  const result = await getOverlappingDowntime(MACHINE_ID, window)

  assert.equal(result.length, 501)
  assert.equal(fakeSupabase.queries.length, 2)
  assert.deepEqual(fakeSupabase.queries[0].orders.map((order) => order.column), ['started_at', 'id'])
  assert.equal(fakeSupabase.queries[0].filters.some((filter) => filter.type === 'lt' && filter.column === 'started_at'), true)
  assert.equal(fakeSupabase.queries[0].filters.some((filter) => filter.type === 'or' && /ended_at\.is\.null,ended_at\.gt\./.test(filter.expression)), true)
})

test('settings history repository pages, validates, and queries both overlap boundaries', async () => {
  clearSourceCache()
  const history = [{
    machine_id: MACHINE_ID,
    version: '1',
    shift_schedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 },
    effective_from: null,
    effective_to: null,
  }]
  const fakeSupabase = createPagedClient({ machine_operational_settings_history: history })
  mockClient(fakeSupabase)
  const { getSettingsHistory } = require('../src/modules/settings/settingsHistory.repository')
  const window = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-02T00:00:00Z') }

  const result = await getSettingsHistory(MACHINE_ID, window)

  assert.equal(result.length, 1)
  assert.equal(fakeSupabase.queries[0].filters.filter((filter) => filter.type === 'or').length, 2)
  assert.deepEqual(fakeSupabase.queries[0].orders.map((order) => order.column), ['effective_from', 'version'])
})

test('settings history repository fails closed on malformed stored schedules', async () => {
  clearSourceCache()
  const fakeSupabase = createPagedClient({
    machine_operational_settings_history: [{
      machine_id: MACHINE_ID,
      version: '1',
      shift_schedule: { workStart: '17:00', workEnd: '08:00', breaks: [], rampUpGraceMinutes: 0 },
      effective_from: null,
      effective_to: null,
    }],
  })
  mockClient(fakeSupabase)
  const { getSettingsHistory } = require('../src/modules/settings/settingsHistory.repository')
  const window = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-02T00:00:00Z') }

  await assert.rejects(
    () => getSettingsHistory(MACHINE_ID, window),
    { code: 'SETTINGS_HISTORY_INVALID', status: 500 },
  )
})
