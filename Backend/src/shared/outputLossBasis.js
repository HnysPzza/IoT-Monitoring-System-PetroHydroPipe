const {
  addBusinessDays,
  formatBusinessDate,
  startOfBusinessDay,
} = require('./businessTime')
const { getEligibleSeconds, getUnionedDowntimeSeconds } = require('./operationalTime')
const { aggregateSensorEvents } = require('./sensorEventAggregation.repository')
const { getOverlappingDowntime } = require('../modules/downtime/downtime.repository')
const { getSettingsHistory } = require('../modules/settings/settingsHistory.repository')

const MINIMUM_PRODUCTION_DAYS = 3
const MINIMUM_PRODUCTIVE_MINUTES = 360
const MINIMUM_OUTPUT_PIECES = 10

function summarize(days) {
  const qualified = days.filter((day) => (
    Number.isFinite(day.outputPieces)
    && day.outputPieces > 0
    && Number.isFinite(day.productiveMinutes)
    && day.productiveMinutes > 0
  ))

  return {
    qualifiedProductionDays: qualified.length,
    productiveMinutes: qualified.reduce((total, day) => total + day.productiveMinutes, 0),
    outputPieces: qualified.reduce((total, day) => total + day.outputPieces, 0),
  }
}

function isSufficient(sample) {
  return sample.qualifiedProductionDays >= MINIMUM_PRODUCTION_DAYS
    && sample.productiveMinutes >= MINIMUM_PRODUCTIVE_MINUTES
    && sample.outputPieces >= MINIMUM_OUTPUT_PIECES
}

function selectOutputLossBasis({ days, fallbackRatePiecesPerMinute, windowEnd }) {
  if (!Number.isFinite(fallbackRatePiecesPerMinute) || fallbackRatePiecesPerMinute <= 0) {
    const error = new Error('Output loss fallback rate must be a positive number.')
    error.code = 'INVALID_OUTPUT_LOSS_RATE'
    throw error
  }

  const end = new Date(windowEnd)
  const sevenDayStart = addBusinessDays(end, -7)
  const thirtyDayStart = addBusinessDays(end, -30)
  const sevenDaySample = summarize(days.filter((day) => (
    new Date(`${day.date}T00:00:00+08:00`) >= sevenDayStart
  )))
  const thirtyDaySample = summarize(days)
  const selected = isSufficient(sevenDaySample)
    ? { source: 'trailing-7-days', start: sevenDayStart, sample: sevenDaySample }
    : isSufficient(thirtyDaySample)
      ? { source: 'trailing-30-days', start: thirtyDayStart, sample: thirtyDaySample }
      : { source: 'configured-fallback', start: thirtyDayStart, sample: thirtyDaySample }
  const rate = selected.source === 'configured-fallback'
    ? fallbackRatePiecesPerMinute
    : selected.sample.outputPieces / selected.sample.productiveMinutes

  return {
    source: selected.source,
    ratePiecesPerMinute: Number(rate.toFixed(6)),
    windowStartAt: selected.start.toISOString(),
    windowEndAt: end.toISOString(),
    ...selected.sample,
  }
}

async function getOutputLossBasis({
  machineId,
  asOf = new Date(),
  fallbackRatePiecesPerMinute,
  dependencies: suppliedDependencies = {},
}) {
  const end = startOfBusinessDay(asOf)
  const start = addBusinessDays(end, -30)
  const window = { start, end }
  const dependencies = {
    aggregateEvents: aggregateSensorEvents,
    getOverlappingDowntime,
    getSettingsHistory,
    ...suppliedDependencies,
  }
  const [eventRows, downtimeRows, settingsHistory] = await Promise.all([
    dependencies.aggregateEvents(machineId, window, 86400),
    dependencies.getOverlappingDowntime(machineId, window),
    dependencies.getSettingsHistory(machineId, window),
  ])
  const outputByDate = eventRows.reduce((totals, row) => {
    if (row.sensor_code !== 'S-05') return totals
    const date = formatBusinessDate(new Date(row.bucket_start))
    totals.set(date, (totals.get(date) || 0) + Number(row.event_count || 0))
    return totals
  }, new Map())
  const days = Array.from({ length: 30 }, (_, index) => {
    const dayStart = addBusinessDays(start, index)
    const dayEnd = addBusinessDays(dayStart, 1)
    const dayWindow = { start: dayStart, end: dayEnd }
    const scheduledSeconds = getEligibleSeconds({ ...dayWindow, settingsHistory })
    const downtime = getUnionedDowntimeSeconds({
      records: downtimeRows,
      windowStart: dayStart,
      windowEnd: dayEnd,
      settingsHistory,
      asOf: end,
    })
    const productiveMinutes = Math.max(0, scheduledSeconds - downtime.unplannedSeconds) / 60
    const date = formatBusinessDate(dayStart)

    return {
      date,
      outputPieces: outputByDate.get(date) || 0,
      productiveMinutes: Number(productiveMinutes.toFixed(2)),
    }
  })

  return selectOutputLossBasis({
    days,
    fallbackRatePiecesPerMinute,
    windowEnd: end,
  })
}

module.exports = { getOutputLossBasis, selectOutputLossBasis }
