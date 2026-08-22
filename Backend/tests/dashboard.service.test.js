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

function mockModule(relativePath, exportsValue) {
  const modulePath = path.join(backendRoot, relativePath)
  require.cache[require.resolve(modulePath)] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  }
}

function createMachineClient() {
  return {
    from(tableName) {
      return {
        select() { return this },
        eq() { return this },
        order() {
          return Promise.resolve({ data: [], error: null })
        },
        maybeSingle() {
          if (tableName === 'machines') {
            return Promise.resolve({
              data: { id: MACHINE_ID, machine_code: 'M-01', name: 'Spiral Mill 01', status: 'Running' },
              error: null,
            })
          }
          throw new Error(`Unexpected maybeSingle query for ${tableName}`)
        },
      }
    },
  }
}

test('dashboard downtime impact includes pre-window events and uses break-aware unplanned loss', async () => {
  clearSourceCache()
  const repositoryCalls = []
  const settingsHistory = [{
    machine_id: MACHINE_ID,
    version: '1',
    shift_schedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 },
    effective_from: null,
    effective_to: null,
  }]
  mockModule('src/database/client.js', { getSupabaseClient: createMachineClient })
  mockModule('src/modules/downtime/downtime.repository.js', {
    getOverlappingDowntime: async (machineId, window) => {
      repositoryCalls.push({ machineId, window })
      return [{
        id: 'down-1',
        machine_id: MACHINE_ID,
        started_at: '2026-08-08T15:30:00.000Z',
        ended_at: '2026-08-09T00:30:00.000Z',
        cause: 'Flux Refill',
        status: 'Resolved',
        sensors: { sensor_code: 'S-01' },
      }]
    },
  })
  mockModule('src/modules/settings/settingsHistory.repository.js', {
    getSettingsHistory: async () => settingsHistory,
  })
  const dashboardService = require('../src/modules/dashboard/dashboard.service')

  const result = await dashboardService.getDowntimeImpact({ trendMode: 'today', date: '2026-08-09' })
  const nineAm = result.points.find((point) => point.label === '9AM')

  assert.equal(repositoryCalls[0].machineId, MACHINE_ID)
  assert.equal(repositoryCalls[0].window.start.toISOString(), '2026-08-08T16:00:00.000Z')
  assert.deepEqual(nineAm, {
    label: '9AM',
    minutes: 510,
    unplannedMinutes: 30,
    plannedExcludedMinutes: 480,
    estimatedLoss: 69,
    cause: 'Flux Refill',
  })
})
