import { analyticsFixture } from './analyticsFixtures.js'

const DAY_MS = 24 * 60 * 60 * 1000

function parseDateInput(value, fieldName = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`A valid ${fieldName} is required.`)
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new RangeError(`A valid ${fieldName} is required.`)
  }

  return date
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date, amount) {
  const nextDate = new Date(date.getTime())
  nextDate.setUTCDate(nextDate.getUTCDate() + amount)
  return nextDate
}

function getMondayStart(date) {
  const weekday = date.getUTCDay()
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1
  return addUtcDays(date, -daysSinceMonday)
}

function getAutomaticBucket(daysInclusive) {
  if (daysInclusive <= 2) return 'four-hour'
  if (daysInclusive <= 14) return 'daily'
  if (daysInclusive <= 93) return 'weekly'
  return 'monthly'
}

export function resolveAnalyticsRange({
  period = 'this-week',
  startDate,
  endDate,
  referenceDate = analyticsFixture.referenceDate,
} = {}) {
  const reference = parseDateInput(referenceDate, 'reference date')
  let start
  let end

  if (period === 'this-week') {
    start = getMondayStart(reference)
    end = addUtcDays(start, 6)
  } else if (period === 'this-month') {
    start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1))
    end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0))
  } else if (period === 'custom') {
    start = parseDateInput(startDate, 'start date')
    end = parseDateInput(endDate, 'end date')
  } else {
    throw new RangeError('Select a supported Analytics date range.')
  }

  if (end < start) {
    throw new RangeError('The end date must be on or after the start date.')
  }

  const daysInclusive = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1

  return {
    period,
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    daysInclusive,
    bucket: getAutomaticBucket(daysInclusive),
  }
}

function isWithinRange(dateValue, range) {
  const date = String(dateValue).slice(0, 10)
  return date >= range.startDate && date <= range.endDate
}

function copyRows(rows) {
  return rows.map((row) => ({ ...row }))
}

export function buildAnalyticsSnapshot(options = {}, fixture = analyticsFixture) {
  const range = resolveAnalyticsRange({
    ...options,
    referenceDate: options.referenceDate || fixture.referenceDate,
  })

  return {
    source: fixture.source,
    timeZone: fixture.timeZone,
    referenceDate: fixture.referenceDate,
    machine: { ...fixture.machine },
    range,
    downtimeEvents: copyRows(fixture.downtimeEvents.filter((event) => isWithinRange(event.startedAt, range))),
    processEvents: copyRows(fixture.processEvents.filter((event) => isWithinRange(event.occurredAt, range))),
    productionRecords: copyRows(fixture.productionRecords.filter((record) => isWithinRange(record.date, range))),
  }
}

// This is intentionally a local Promise seam. Future backend work can replace it
// behind the same interface without allowing this UI pass to make network calls.
export function getAnalyticsSnapshot(options = {}) {
  return Promise.resolve(buildAnalyticsSnapshot(options))
}

export function createAnalyticsFixtureService({ fixture = analyticsFixture, failure } = {}) {
  return {
    getSnapshot(options = {}) {
      if (failure) {
        return Promise.reject(failure instanceof Error ? failure : new Error(String(failure)))
      }

      return Promise.resolve(buildAnalyticsSnapshot(options, fixture))
    },
  }
}
