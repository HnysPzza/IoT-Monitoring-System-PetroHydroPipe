const assert = require('node:assert/strict')
const test = require('node:test')

function loadSelector() {
  try {
    return require('../src/shared/outputLossBasis').selectOutputLossBasis
  } catch {
    return undefined
  }
}

function loadResolver() {
  try {
    return require('../src/shared/outputLossBasis').getOutputLossBasis
  } catch {
    return undefined
  }
}

function productionDay(index, outputPieces = 6, productiveMinutes = 120) {
  return {
    date: `2026-08-${String(index).padStart(2, '0')}`,
    outputPieces,
    productiveMinutes,
  }
}

test('output loss basis uses seven completed days when sample is sufficient', () => {
  const selectOutputLossBasis = loadSelector()
  assert.equal(typeof selectOutputLossBasis, 'function')

  const result = selectOutputLossBasis({
    days: Array.from({ length: 7 }, (_, index) => productionDay(index + 25)),
    fallbackRatePiecesPerMinute: 0.05,
    windowEnd: new Date('2026-08-31T16:00:00.000Z'),
  })

  assert.deepEqual(result, {
    source: 'trailing-7-days',
    ratePiecesPerMinute: 0.05,
    windowStartAt: '2026-08-24T16:00:00.000Z',
    windowEndAt: '2026-08-31T16:00:00.000Z',
    qualifiedProductionDays: 7,
    productiveMinutes: 840,
    outputPieces: 42,
  })
})

test('output loss basis expands to thirty days when seven-day sample is insufficient', () => {
  const selectOutputLossBasis = loadSelector()
  assert.equal(typeof selectOutputLossBasis, 'function')

  const days = Array.from({ length: 30 }, (_, index) => productionDay(index + 2, 0, 120))
  days[4].outputPieces = 6
  days[9].outputPieces = 6
  days[14].outputPieces = 6

  const result = selectOutputLossBasis({
    days,
    fallbackRatePiecesPerMinute: 0.05,
    windowEnd: new Date('2026-08-31T16:00:00.000Z'),
  })

  assert.equal(result.source, 'trailing-30-days')
  assert.equal(result.qualifiedProductionDays, 3)
  assert.equal(result.productiveMinutes, 360)
  assert.equal(result.outputPieces, 18)
  assert.equal(result.ratePiecesPerMinute, 0.05)
})

test('output loss basis uses configured fallback when thirty-day evidence is insufficient', () => {
  const selectOutputLossBasis = loadSelector()
  assert.equal(typeof selectOutputLossBasis, 'function')

  const result = selectOutputLossBasis({
    days: [productionDay(29, 4, 120), productionDay(30, 4, 120)],
    fallbackRatePiecesPerMinute: 0.05,
    windowEnd: new Date('2026-08-31T16:00:00.000Z'),
  })

  assert.deepEqual(result, {
    source: 'configured-fallback',
    ratePiecesPerMinute: 0.05,
    windowStartAt: '2026-08-01T16:00:00.000Z',
    windowEndAt: '2026-08-31T16:00:00.000Z',
    qualifiedProductionDays: 2,
    productiveMinutes: 240,
    outputPieces: 8,
  })
})

test('output loss basis requires at least ten output pieces', () => {
  const selectOutputLossBasis = loadSelector()
  const days = [productionDay(28, 4), productionDay(29, 3), productionDay(30, 3)]

  assert.equal(selectOutputLossBasis({
    days,
    fallbackRatePiecesPerMinute: 0.05,
    windowEnd: new Date('2026-08-31T16:00:00.000Z'),
  }).source, 'trailing-7-days')

  days[2].outputPieces = 2
  assert.equal(selectOutputLossBasis({
    days,
    fallbackRatePiecesPerMinute: 0.05,
    windowEnd: new Date('2026-08-31T16:00:00.000Z'),
  }).source, 'configured-fallback')
})

test('output loss resolver uses one bounded query set and excludes current partial day', async () => {
  const getOutputLossBasis = loadResolver()
  assert.equal(typeof getOutputLossBasis, 'function')
  const calls = []
  const settingsHistory = [{
    version: '1',
    shift_schedule: { workStart: '08:00', workEnd: '10:00', breaks: [], rampUpGraceMinutes: 0 },
    effective_from: null,
    effective_to: null,
  }]

  const result = await getOutputLossBasis({
    machineId: '11111111-1111-4111-8111-111111111111',
    asOf: new Date('2026-08-31T12:00:00+08:00'),
    fallbackRatePiecesPerMinute: 0.05,
    dependencies: {
      aggregateEvents: async (machineId, window, bucketSeconds) => {
        calls.push({ type: 'events', machineId, window, bucketSeconds })
        return [
          { bucket_start: '2026-08-27T16:00:00.000Z', sensor_code: 'S-05', event_count: 6 },
          { bucket_start: '2026-08-28T16:00:00.000Z', sensor_code: 'S-05', event_count: 6 },
          { bucket_start: '2026-08-29T16:00:00.000Z', sensor_code: 'S-05', event_count: 6 },
        ]
      },
      getOverlappingDowntime: async (machineId, window) => {
        calls.push({ type: 'downtime', machineId, window })
        return []
      },
      getSettingsHistory: async (machineId, window) => {
        calls.push({ type: 'settings', machineId, window })
        return settingsHistory
      },
    },
  })

  assert.equal(result.source, 'trailing-7-days')
  assert.equal(result.windowEndAt, '2026-08-30T16:00:00.000Z')
  assert.equal(result.productiveMinutes, 360)
  assert.equal(result.outputPieces, 18)
  assert.equal(calls.length, 3)
  assert.equal(calls[0].bucketSeconds, 86400)
  assert.equal(calls.every((call) => call.window.end.toISOString() === result.windowEndAt), true)
})
