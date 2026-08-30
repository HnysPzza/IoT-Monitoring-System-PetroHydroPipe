const assert = require('node:assert/strict')
const test = require('node:test')

const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const settingsHistory = [{
  machine_id: MACHINE_ID,
  version: '1',
  shift_schedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 },
  effective_from: null,
  effective_to: null,
}]

function createDependencies({ eventRows = [], downtimeRows = [] } = {}) {
  const aggregationCalls = []
  return {
    aggregationCalls,
    dependencies: {
      asOf: new Date('2026-08-03T12:00:00+08:00'),
      getMachineAndSensors: async () => ({
        id: MACHINE_ID,
        name: 'Spiral Mill 01',
        sensors: [
          { sensor_code: 'S-01', label: 'Raw Material & Coil Joint' },
          { sensor_code: 'S-02', label: 'Inside Filler Wire' },
          { sensor_code: 'S-03', label: 'Machine Main Sensor' },
          { sensor_code: 'S-04', label: 'Outside Filler Wire' },
          { sensor_code: 'S-05', label: 'Production Output Cutting' },
        ],
      }),
      getFirstRecordedAt: async () => new Date('2024-01-15T03:00:00.000Z'),
      aggregateEvents: async (machineId, window, bucketSeconds) => {
        aggregationCalls.push({ machineId, window, bucketSeconds })
        return eventRows.filter((row) => {
          const bucketTime = new Date(row.bucket_start).getTime()
          return bucketTime >= window.start.getTime() && bucketTime < window.end.getTime()
        })
      },
      getOverlappingDowntime: async () => downtimeRows,
      getSettingsHistory: async () => settingsHistory,
    },
  }
}

test('Analytics compares a partial Manila range with the matching elapsed preceding range', async () => {
  const { getAnalytics } = require('../src/modules/analytics/analytics.service')
  const { dependencies, aggregationCalls } = createDependencies({
    eventRows: [
      { bucket_start: '2026-07-31T16:00:00.000Z', sensor_code: 'S-05', sensor_label: 'Production Output Cutting', event_count: 4 },
      { bucket_start: '2026-07-31T16:00:00.000Z', sensor_code: 'S-01', sensor_label: 'Raw Material & Coil Joint', event_count: 3 },
      { bucket_start: '2026-07-26T16:00:00.000Z', sensor_code: 'S-05', sensor_label: 'Production Output Cutting', event_count: 2 },
    ],
  })

  const result = await getAnalytics({ startDate: '2026-08-01', endDate: '2026-08-05' }, dependencies)

  assert.equal(result.timeZone, 'Asia/Manila')
  assert.equal(result.comparisonMode, 'immediately-preceding-matching-elapsed')
  assert.equal(result.comparisonClipped, true)
  assert.deepEqual(result.selected.range, {
    requestedStartDate: '2026-08-01',
    requestedEndDate: '2026-08-05',
    observedStartAt: '2026-07-31T16:00:00.000Z',
    observedEndAt: '2026-08-03T04:00:00.000Z',
    periodState: 'partial',
    daysInclusive: 5,
    bucket: 'daily',
  })
  assert.equal(result.comparison.range.requestedStartDate, '2026-07-27')
  assert.equal(result.comparison.range.requestedEndDate, '2026-07-31')
  assert.equal(result.comparison.range.observedEndAt, '2026-07-29T04:00:00.000Z')
  assert.equal(result.selected.summary.outputPieces, 4)
  assert.equal(result.selected.summary.processEventCount, 3)
  assert.equal(result.comparison.summary.outputPieces, 2)
  assert.equal(result.selected.summary.availabilityPercent, 100)
  assert.equal(result.selected.trends.at(-1).periodState, 'future')
  assert.equal(result.selected.trends.at(-1).metrics.availabilityPercent, null)
  assert.equal(aggregationCalls.every((call) => call.bucketSeconds === 86400), true)
  assert.equal(result.coverage.historicalHeartbeatAvailable, false)
})

test('Analytics preserves measured zero but returns null for a future-only selected range', async () => {
  const { getAnalytics } = require('../src/modules/analytics/analytics.service')
  const { dependencies } = createDependencies()

  const observed = await getAnalytics({ startDate: '2026-08-01', endDate: '2026-08-01' }, dependencies)
  assert.equal(observed.selected.summary.outputPieces, 0)
  assert.equal(observed.selected.summary.processEventCount, 0)

  const future = await getAnalytics({ startDate: '2026-08-10', endDate: '2026-08-10' }, dependencies)
  assert.equal(future.selected.range.periodState, 'future')
  assert.deepEqual(future.selected.summary, {
    downtimeMinutes: null,
    downtimeEventCount: null,
    availabilityPercent: null,
    outputPieces: null,
    processEventCount: null,
    estimatedLossPieces: null,
  })
  assert.equal(future.selected.trends.every((point) => point.periodState === 'future'), true)
})

test('Analytics unions concurrent downtime and keeps zero-eligible availability unobserved', async () => {
  const { getAnalytics } = require('../src/modules/analytics/analytics.service')
  const { dependencies } = createDependencies({
    downtimeRows: [
      { id: 'd1', started_at: '2026-08-03T00:00:00.000Z', ended_at: '2026-08-03T01:00:00.000Z', cause: 'Flux Refill', sensors: { sensor_code: 'S-01' } },
      { id: 'd2', started_at: '2026-08-03T00:30:00.000Z', ended_at: '2026-08-03T01:30:00.000Z', cause: 'Wire Refill', sensors: { sensor_code: 'S-02' } },
    ],
  })

  const result = await getAnalytics({ startDate: '2026-08-02', endDate: '2026-08-03' }, dependencies)
  assert.equal(result.selected.summary.downtimeMinutes, 90)
  assert.equal(result.selected.summary.estimatedLossPieces, 207)
  assert.equal(result.selected.trends[0].metrics.availabilityPercent, null)
  assert.equal(result.selected.downtimeCauses.some((row) => row.cause === 'Concurrent causes'), true)
})

test('Analytics uses calendar-month buckets for ranges longer than 93 days', async () => {
  const { getAnalytics } = require('../src/modules/analytics/analytics.service')
  const { dependencies, aggregationCalls } = createDependencies()

  const result = await getAnalytics({ startDate: '2026-01-15', endDate: '2026-05-15' }, dependencies)

  assert.equal(result.selected.range.bucket, 'monthly')
  assert.equal(result.selected.trends[0].startAt, '2026-01-14T16:00:00.000Z')
  assert.equal(result.selected.trends[0].endAt, '2026-01-31T16:00:00.000Z')
  assert.deepEqual(result.trendAlignment, {
    mode: 'ordinal-calendar-segments',
    selectedBucketCount: result.selected.trends.length,
    comparisonBucketCount: result.comparison.trends.length,
  })
  assert.equal(aggregationCalls.every((call) => call.bucketSeconds === 0), true)
})

test('Analytics declares unequal calendar-month segment counts without dropping either period', async () => {
  const { getAnalytics } = require('../src/modules/analytics/analytics.service')
  const { dependencies } = createDependencies()

  const result = await getAnalytics({ startDate: '2025-01-02', endDate: '2025-04-05' }, dependencies)

  assert.equal(result.selected.trends.length, 4)
  assert.equal(result.comparison.trends.length, 5)
  assert.deepEqual(result.trendAlignment, {
    mode: 'ordinal-calendar-segments',
    selectedBucketCount: 4,
    comparisonBucketCount: 5,
  })
})

test('Analytics all-time range starts on the first contributing record and bypasses only the custom 366-day limit', async () => {
  const { getAnalytics } = require('../src/modules/analytics/analytics.service')
  const { dependencies, aggregationCalls } = createDependencies()

  const result = await getAnalytics({ range: 'all' }, dependencies)

  assert.equal(result.selectionMode, 'all')
  assert.equal(result.selected.range.requestedStartDate, '2024-01-15')
  assert.equal(result.selected.range.requestedEndDate, '2026-08-03')
  assert.equal(result.selected.range.daysInclusive, 932)
  assert.equal(result.selected.range.bucket, 'monthly')
  assert.equal(aggregationCalls.every((call) => call.bucketSeconds === 0), true)
})
