const { BUSINESS_TIME_ZONE, formatBusinessDate } = require('./businessTime')

const BUSINESS_UTC_OFFSET = '+08:00'
const SECOND_MS = 1000
const WEEKDAYS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
])
const VALID_WEEKDAYS = new Set(WEEKDAYS)

function createOperationalTimeError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function toInstant(value, fieldName) {
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (Number.isNaN(instant.getTime())) {
    throw createOperationalTimeError('INVALID_INTERVAL', `${fieldName} must be a valid timestamp.`)
  }

  return instant
}

function requireInterval(startValue, endValue, label = 'Interval') {
  const start = toInstant(startValue, `${label} start`)
  const end = toInstant(endValue, `${label} end`)

  if (start >= end) {
    throw createOperationalTimeError('INVALID_INTERVAL', `${label} end must be later than its start.`)
  }

  return { start, end }
}

function intervalSeconds(interval) {
  return Math.floor((interval.end.getTime() - interval.start.getTime()) / SECOND_MS)
}

function intersectIntervals(left, right) {
  const start = new Date(Math.max(left.start.getTime(), right.start.getTime()))
  const end = new Date(Math.min(left.end.getTime(), right.end.getTime()))
  return start < end ? { start, end } : null
}

function unionIntervals(intervals) {
  const ordered = intervals
    .map((interval, index) => requireInterval(interval.start, interval.end, `Interval ${index + 1}`))
    .sort((left, right) => left.start - right.start || left.end - right.end)

  return ordered.reduce((merged, interval) => {
    const previous = merged.at(-1)

    if (!previous || interval.start > previous.end) {
      merged.push(interval)
      return merged
    }

    if (interval.end > previous.end) previous.end = interval.end
    return merged
  }, [])
}

function subtractIntervals(base, exclusions) {
  const normalizedBase = requireInterval(base.start, base.end, 'Base interval')
  const clippedExclusions = unionIntervals(
    exclusions
      .map((interval) => intersectIntervals(normalizedBase, requireInterval(interval.start, interval.end, 'Excluded interval')))
      .filter(Boolean),
  )
  const result = []
  let cursor = normalizedBase.start

  clippedExclusions.forEach((exclusion) => {
    if (cursor < exclusion.start) result.push({ start: cursor, end: exclusion.start })
    if (exclusion.end > cursor) cursor = exclusion.end
  })

  if (cursor < normalizedBase.end) result.push({ start: cursor, end: normalizedBase.end })
  return result
}

function parseTime(value, fieldName) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw createOperationalTimeError('INVALID_SCHEDULE', `${fieldName} must use 24-hour HH:MM format.`)
  }

  const [hours, minutes] = value.split(':').map(Number)
  return (hours * 60) + minutes
}

function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw createOperationalTimeError('INVALID_SCHEDULE', 'Shift schedule must be an object.')
  }

  const workStart = parseTime(schedule.workStart, 'workStart')
  const workEnd = parseTime(schedule.workEnd, 'workEnd')
  const graceMinutes = schedule.rampUpGraceMinutes

  if (workStart >= workEnd) {
    throw createOperationalTimeError('INVALID_SCHEDULE', 'Work end must be later than work start.')
  }

  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 30) {
    throw createOperationalTimeError('INVALID_SCHEDULE', 'Ramp-up grace must be an integer from 0 to 30.')
  }

  if (!Array.isArray(schedule.breaks) || schedule.breaks.length > 10) {
    throw createOperationalTimeError('INVALID_SCHEDULE', 'Breaks must be an array with at most 10 entries.')
  }

  const breaks = schedule.breaks.map((shiftBreak, index) => {
    const start = parseTime(shiftBreak?.startTime, `breaks[${index}].startTime`)
    const end = parseTime(shiftBreak?.endTime, `breaks[${index}].endTime`)

    if (start >= end || start < workStart || end > workEnd || end + graceMinutes > workEnd) {
      throw createOperationalTimeError('INVALID_SCHEDULE', `Break ${index + 1} is outside the valid work window.`)
    }

    return { start, end: end + graceMinutes }
  }).sort((left, right) => left.start - right.start || left.end - right.end)

  for (let index = 1; index < breaks.length; index += 1) {
    if (breaks[index].start < breaks[index - 1].end) {
      throw createOperationalTimeError('INVALID_SCHEDULE', 'Break and grace windows must not overlap.')
    }
  }

  const rawRestDays = schedule.restDays === undefined ? [] : schedule.restDays
  if (!Array.isArray(rawRestDays) || rawRestDays.length > 6) {
    throw createOperationalTimeError('INVALID_SCHEDULE', 'Rest days must be an array with at most 6 weekdays.')
  }

  const restDays = new Set()
  for (const dayName of rawRestDays) {
    if (typeof dayName !== 'string' || !VALID_WEEKDAYS.has(dayName) || restDays.has(dayName)) {
      throw createOperationalTimeError('INVALID_SCHEDULE', 'Rest days must contain unique lowercase weekday names.')
    }
    restDays.add(dayName)
  }

  return { workStart, workEnd, breaks, restDays }
}

function getHistoryValue(record, camelName, snakeName) {
  return record[camelName] === undefined ? record[snakeName] : record[camelName]
}

function normalizeSettingsHistory(settingsHistory, range) {
  if (!Array.isArray(settingsHistory) || settingsHistory.length === 0) {
    throw createOperationalTimeError('SETTINGS_HISTORY_GAP', 'Operational settings history is required.')
  }

  const normalized = settingsHistory.map((record, index) => {
    const effectiveFromValue = getHistoryValue(record, 'effectiveFrom', 'effective_from')
    const effectiveToValue = getHistoryValue(record, 'effectiveTo', 'effective_to')
    const shiftSchedule = getHistoryValue(record, 'shiftSchedule', 'shift_schedule')
    const effectiveFrom = effectiveFromValue == null ? null : toInstant(effectiveFromValue, `History ${index + 1} effectiveFrom`)
    const effectiveTo = effectiveToValue == null ? null : toInstant(effectiveToValue, `History ${index + 1} effectiveTo`)

    if (effectiveFrom && effectiveTo && effectiveFrom >= effectiveTo) {
      throw createOperationalTimeError('SETTINGS_HISTORY_INVALID', 'Settings history contains a reversed interval.')
    }

    return {
      effectiveFrom,
      effectiveTo,
      schedule: validateSchedule(shiftSchedule),
      version: getHistoryValue(record, 'version', 'version') ?? null,
    }
  })

  const boundaries = new Set([range.start.getTime(), range.end.getTime()])
  normalized.forEach((record) => {
    if (record.effectiveFrom && record.effectiveFrom > range.start && record.effectiveFrom < range.end) {
      boundaries.add(record.effectiveFrom.getTime())
    }
    if (record.effectiveTo && record.effectiveTo > range.start && record.effectiveTo < range.end) {
      boundaries.add(record.effectiveTo.getTime())
    }
  })

  const orderedBoundaries = [...boundaries].sort((left, right) => left - right)
  return orderedBoundaries.slice(0, -1).map((startMs, index) => {
    const endMs = orderedBoundaries[index + 1]
    const matches = normalized.filter((record) => (
      (record.effectiveFrom === null || record.effectiveFrom.getTime() <= startMs)
      && (record.effectiveTo === null || record.effectiveTo.getTime() >= endMs)
    ))

    if (matches.length !== 1) {
      const code = matches.length === 0 ? 'SETTINGS_HISTORY_GAP' : 'SETTINGS_HISTORY_OVERLAP'
      throw createOperationalTimeError(code, 'Settings history must cover the requested range exactly once.')
    }

    return {
      start: new Date(startMs),
      end: new Date(endMs),
      schedule: matches[0].schedule,
      version: matches[0].version,
    }
  })
}

function addBusinessDate(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day + days))
  return value.toISOString().slice(0, 10)
}

function weekdayForBusinessDate(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const dayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return WEEKDAYS[dayIndex]
}

function normalizeCalendarDateKey(value) {
  if (value instanceof Date) {
    return formatBusinessDate(value)
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  throw createOperationalTimeError('INVALID_CALENDAR_DAY', 'Calendar date must use YYYY-MM-DD format.')
}

function normalizeCalendarDays(calendarDays, settingsHistory) {
  const source = calendarDays === undefined ? settingsHistory?.calendarDays : calendarDays
  const lookup = new Map()
  if (!source) return lookup

  if (source instanceof Map) {
    for (const [key, value] of source.entries()) {
      const dateKey = normalizeCalendarDateKey(key)
      const isWorking = typeof value === 'boolean'
        ? value
        : getHistoryValue(value || {}, 'isWorking', 'is_working')
      if (typeof isWorking !== 'boolean') {
        throw createOperationalTimeError('INVALID_CALENDAR_DAY', 'Calendar day requires a boolean isWorking flag.')
      }
      lookup.set(dateKey, isWorking)
    }
    return lookup
  }

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!entry || typeof entry !== 'object') {
        throw createOperationalTimeError('INVALID_CALENDAR_DAY', 'Calendar day entry must be an object.')
      }
      const rawDate = getHistoryValue(entry, 'calendarDate', 'calendar_date')
      const isWorking = getHistoryValue(entry, 'isWorking', 'is_working')
      if (typeof isWorking !== 'boolean') {
        throw createOperationalTimeError('INVALID_CALENDAR_DAY', 'Calendar day requires a boolean isWorking flag.')
      }
      lookup.set(normalizeCalendarDateKey(rawDate), isWorking)
    }
    return lookup
  }

  if (typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      const dateKey = normalizeCalendarDateKey(key)
      const isWorking = typeof value === 'boolean'
        ? value
        : getHistoryValue(value || {}, 'isWorking', 'is_working')
      if (typeof isWorking !== 'boolean') {
        throw createOperationalTimeError('INVALID_CALENDAR_DAY', 'Calendar day requires a boolean isWorking flag.')
      }
      lookup.set(dateKey, isWorking)
    }
    return lookup
  }

  throw createOperationalTimeError('INVALID_CALENDAR_DAY', 'Calendar days must be an array, Map, or object.')
}

function instantForMinute(dateKey, minuteOfDay) {
  const hours = Math.floor(minuteOfDay / 60)
  const minutes = minuteOfDay % 60
  return new Date(`${dateKey}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00${BUSINESS_UTC_OFFSET}`)
}

function enumerateBusinessDates(start, end) {
  const firstDate = formatBusinessDate(start)
  const lastInstant = new Date(end.getTime() - 1)
  const lastDate = formatBusinessDate(lastInstant)
  const dates = []
  let dateKey = firstDate

  while (dateKey <= lastDate) {
    dates.push(dateKey)
    dateKey = addBusinessDate(dateKey, 1)
  }

  return dates
}

function buildEligibleIntervals({ start, end, settingsHistory, calendarDays }) {
  const range = requireInterval(start, end, 'Requested range')
  const historySegments = normalizeSettingsHistory(settingsHistory, range)
  const calendarLookup = normalizeCalendarDays(calendarDays, settingsHistory)
  const eligible = []

  historySegments.forEach((segment) => {
    enumerateBusinessDates(segment.start, segment.end).forEach((dateKey) => {
      if (calendarLookup.has(dateKey)) {
        if (!calendarLookup.get(dateKey)) return
      } else if (segment.schedule.restDays.has(weekdayForBusinessDate(dateKey))) {
        return
      }

      const work = {
        start: instantForMinute(dateKey, segment.schedule.workStart),
        end: instantForMinute(dateKey, segment.schedule.workEnd),
      }
      const exclusions = segment.schedule.breaks.map((shiftBreak) => ({
        start: instantForMinute(dateKey, shiftBreak.start),
        end: instantForMinute(dateKey, shiftBreak.end),
      }))

      subtractIntervals(work, exclusions).forEach((workInterval) => {
        const clippedToRange = intersectIntervals(workInterval, range)
        const clippedToHistory = clippedToRange && intersectIntervals(clippedToRange, segment)
        if (clippedToHistory) eligible.push(clippedToHistory)
      })
    })
  })

  return unionIntervals(eligible)
}

function sumIntervalSeconds(intervals) {
  return intervals.reduce((total, interval) => total + intervalSeconds(interval), 0)
}

function getEligibleSeconds({ start, end, settingsHistory, calendarDays }) {
  return sumIntervalSeconds(buildEligibleIntervals({ start, end, settingsHistory, calendarDays }))
}

function isEligibleAt({ at, settingsHistory, calendarDays }) {
  const instant = toInstant(at, 'Eligibility timestamp')
  const end = new Date(instant.getTime() + SECOND_MS)
  return getEligibleSeconds({ start: instant, end, settingsHistory, calendarDays }) === 1
}

function advanceByEligibleSeconds({ start, end, seconds, settingsHistory, calendarDays }) {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw createOperationalTimeError('INVALID_DURATION', 'Eligible seconds must be a non-negative integer.')
  }

  const range = requireInterval(start, end, 'Advance range')
  if (seconds === 0) return range.start
  let remaining = seconds

  for (const interval of buildEligibleIntervals({ ...range, settingsHistory, calendarDays })) {
    const available = intervalSeconds(interval)
    if (remaining <= available) {
      return new Date(interval.start.getTime() + (remaining * SECOND_MS))
    }
    remaining -= available
  }

  return null
}

function clipDowntimeInterval(record, window, asOf) {
  const startedAt = getHistoryValue(record, 'startedAt', 'started_at')
  const endedAtValue = getHistoryValue(record, 'endedAt', 'ended_at')
  const endedAt = endedAtValue == null ? asOf : endedAtValue
  const downtime = requireInterval(startedAt, endedAt, 'Downtime interval')
  return intersectIntervals(downtime, window)
}

function calculateDowntimeBreakdown({ record, windowStart, windowEnd, settingsHistory, calendarDays, asOf = new Date() }) {
  const window = requireInterval(windowStart, windowEnd, 'Metric window')
  const clipped = clipDowntimeInterval(record, window, toInstant(asOf, 'asOf'))

  if (!clipped) {
    return { durationSeconds: 0, unplannedSeconds: 0, plannedExcludedSeconds: 0 }
  }

  const durationSeconds = intervalSeconds(clipped)
  const unplannedSeconds = getEligibleSeconds({ ...clipped, settingsHistory, calendarDays })
  return {
    durationSeconds,
    unplannedSeconds,
    plannedExcludedSeconds: durationSeconds - unplannedSeconds,
  }
}

function getUnionedDowntimeSeconds({ records, windowStart, windowEnd, settingsHistory, calendarDays, asOf = new Date() }) {
  const window = requireInterval(windowStart, windowEnd, 'Metric window')
  const effectiveAsOf = toInstant(asOf, 'asOf')
  const clipped = records
    .map((record) => clipDowntimeInterval(record, window, effectiveAsOf))
    .filter(Boolean)
  const unioned = unionIntervals(clipped)
  const durationSeconds = sumIntervalSeconds(unioned)
  const unplannedSeconds = unioned.reduce(
    (total, interval) => total + getEligibleSeconds({ ...interval, settingsHistory, calendarDays }),
    0,
  )

  return {
    intervals: unioned,
    durationSeconds,
    unplannedSeconds,
    plannedExcludedSeconds: durationSeconds - unplannedSeconds,
  }
}

module.exports = {
  BUSINESS_TIME_ZONE,
  advanceByEligibleSeconds,
  buildEligibleIntervals,
  calculateDowntimeBreakdown,
  getEligibleSeconds,
  getUnionedDowntimeSeconds,
  intersectIntervals,
  intervalSeconds,
  isEligibleAt,
  subtractIntervals,
  unionIntervals,
}
