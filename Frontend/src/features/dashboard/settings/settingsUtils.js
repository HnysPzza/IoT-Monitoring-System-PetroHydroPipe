export const WEEKDAYS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
])

export const WEEKDAY_OPTIONS = Object.freeze([
  { value: 'sunday', label: 'Sunday', shortLabel: 'Sun' },
  { value: 'monday', label: 'Monday', shortLabel: 'Mon' },
  { value: 'tuesday', label: 'Tuesday', shortLabel: 'Tue' },
  { value: 'wednesday', label: 'Wednesday', shortLabel: 'Wed' },
  { value: 'thursday', label: 'Thursday', shortLabel: 'Thu' },
  { value: 'friday', label: 'Friday', shortLabel: 'Fri' },
  { value: 'saturday', label: 'Saturday', shortLabel: 'Sat' },
])

export function normalizeRestDays(restDays) {
  if (!Array.isArray(restDays)) return []
  const validSet = new Set(WEEKDAYS)
  const unique = new Set(
    restDays
      .filter((day) => typeof day === 'string')
      .map((day) => day.trim().toLowerCase())
      .filter((day) => validSet.has(day)),
  )
  return WEEKDAYS.filter((day) => unique.has(day))
}

export function cloneSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings
  const cloned = JSON.parse(JSON.stringify(settings))
  if (cloned.shiftSchedule && typeof cloned.shiftSchedule === 'object') {
    cloned.shiftSchedule.restDays = Array.isArray(cloned.shiftSchedule.restDays)
      ? [...cloned.shiftSchedule.restDays]
      : []
  }
  return cloned
}

export function sortBreaks(breaks) {
  return [...breaks].sort((left, right) => (left.startTime || '').localeCompare(right.startTime || ''))
}

function toMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (hours > 23 || minutes > 59) return null
  return (hours * 60) + minutes
}

function formatMinutes(totalMinutes) {
  const clamped = Math.max(0, Math.min((23 * 60) + 59, Math.floor(totalMinutes)))
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0')
  const minutes = String(clamped % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function getNextBreakSlot(schedule, durationMinutes = 15) {
  const workStart = toMinutes(schedule?.workStart) ?? (8 * 60)
  const workEnd = toMinutes(schedule?.workEnd) ?? (17 * 60)
  const grace = Number.isInteger(schedule?.rampUpGraceMinutes)
    ? Math.max(0, schedule.rampUpGraceMinutes)
    : 0
  const validIntervals = sortBreaks(Array.isArray(schedule?.breaks) ? schedule.breaks : [])
    .map((entry) => ({ start: toMinutes(entry.startTime), end: toMinutes(entry.endTime) }))
    .filter((entry) => entry.start !== null && entry.end !== null && entry.start < entry.end)

  function fitsSlot(candidateStart) {
    const candidateEnd = candidateStart + durationMinutes
    if (candidateStart < workStart || candidateEnd + grace > workEnd) return false
    return validIntervals.every((interval) => (
      candidateEnd + grace <= interval.start || candidateStart >= interval.end + grace
    ))
  }

  const preferredStart = Math.max(10 * 60, workStart)
  const candidates = [
    preferredStart,
    ...validIntervals.filter((item) => item.end >= preferredStart).map((item) => item.end + grace),
    ...validIntervals.filter((item) => item.end < preferredStart).map((item) => item.end + grace),
    workStart,
  ]

  for (const start of candidates) {
    if (fitsSlot(start)) {
      return { startTime: formatMinutes(start), endTime: formatMinutes(start + durationMinutes) }
    }
  }
  return { startTime: '10:00', endTime: '10:15' }
}

const DEFAULT_SPINDLE_SENSOR_CODE = 'S-03'
const DEFAULT_ROTATION_STALL_BOUNDS = { minimum: 500, maximum: 30000, default: 3000 }

export function getMinuteBounds(secondBounds) {
  return {
    minimumWhenEnabled: Math.max(1, Math.ceil((secondBounds?.minimumWhenEnabled || 60) / 60)),
    maximum: Math.max(1, Math.floor((secondBounds?.maximum || 60) / 60)),
  }
}

export function getRotationStallSecondsBounds(stallBounds = DEFAULT_ROTATION_STALL_BOUNDS) {
  const minimumMs = stallBounds?.minimum ?? DEFAULT_ROTATION_STALL_BOUNDS.minimum
  const maximumMs = stallBounds?.maximum ?? DEFAULT_ROTATION_STALL_BOUNDS.maximum
  const defaultMs = stallBounds?.default ?? DEFAULT_ROTATION_STALL_BOUNDS.default
  return {
    minimumMs,
    maximumMs,
    defaultMs,
    minimum: Number((minimumMs / 1000).toFixed(3)),
    maximum: Number((maximumMs / 1000).toFixed(3)),
  }
}

function evaluateBreaks(schedule, constraints) {
  const invalidIndices = new Set()
  const maxBreaks = constraints?.breaks?.maximum ?? 10
  const breaks = Array.isArray(schedule?.breaks) ? schedule.breaks : null
  if (!breaks || breaks.length > maxBreaks) {
    if (Array.isArray(breaks)) {
      breaks.forEach((_, idx) => {
        if (idx >= maxBreaks) invalidIndices.add(idx)
      })
    }
    return {
      errorMessage: `At most ${maxBreaks} breaks are allowed.`,
      invalidIndices,
    }
  }

  const workStart = toMinutes(schedule.workStart)
  const workEnd = toMinutes(schedule.workEnd)
  const grace = Number.isInteger(schedule.rampUpGraceMinutes) ? schedule.rampUpGraceMinutes : 0
  const names = new Map()
  let errorMessage = null

  const sorted = breaks
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort((left, right) => (left.entry.startTime || '').localeCompare(right.entry.startTime || ''))

  sorted.forEach(({ entry, originalIndex }, index) => {
    const start = toMinutes(entry.startTime)
    const end = toMinutes(entry.endTime)
    const label = entry.name?.trim() || `Break ${index + 1}`
    const name = (entry.name || '').trim().toLowerCase()
    const previousEnd = index > 0 ? toMinutes(sorted[index - 1].entry.endTime) : null
    const previousGraceEnd = previousEnd === null ? null : previousEnd + grace

    if (!name) {
      invalidIndices.add(originalIndex)
      errorMessage = 'Breaks need unique names, valid times, and no overlap inside the shift.'
    } else if (names.has(name)) {
      invalidIndices.add(originalIndex)
      invalidIndices.add(names.get(name))
      errorMessage = 'Breaks need unique names, valid times, and no overlap inside the shift.'
    } else if (start === null || end === null || start >= end) {
      invalidIndices.add(originalIndex)
      errorMessage = `${label} end time must be later than start time (valid times and no overlap inside the shift).`
    } else if (workStart !== null && workEnd !== null && (start < workStart || end > workEnd)) {
      invalidIndices.add(originalIndex)
      errorMessage = `${label} must stay within operating hours (${schedule.workStart}–${schedule.workEnd}, no overlap inside the shift).`
    } else if (workEnd !== null && end + grace > workEnd) {
      invalidIndices.add(originalIndex)
      errorMessage = `${label} plus the ${grace}m grace period exceeds work end (${schedule.workEnd}, no overlap inside the shift).`
    } else if (previousGraceEnd !== null && start < previousGraceEnd) {
      invalidIndices.add(originalIndex)
      const prevLabel = sorted[index - 1].entry.name?.trim() || `Break ${index}`
      errorMessage = `${label} overlaps ${prevLabel} plus its ${grace}m grace period (no overlap inside the shift).`
    }

    if (name && !names.has(name)) {
      names.set(name, originalIndex)
    }
  })

  return { errorMessage, invalidIndices }
}

export function getInvalidBreakIndices(schedule, constraints) {
  return evaluateBreaks(schedule, constraints).invalidIndices
}

function formatMinuteRange(bounds) {
  return bounds.minimumWhenEnabled === bounds.maximum
    ? `${bounds.minimumWhenEnabled} minute${bounds.minimumWhenEnabled === 1 ? '' : 's'}`
    : `${bounds.minimumWhenEnabled}-${bounds.maximum} minutes`
}

export function validateOperationalSettings(settings, constraints) {
  const errors = {}
  const thresholds = settings?.sensorThresholds || {}
  const triggerMinutes = getMinuteBounds(constraints.triggerSeconds)
  const recoveryMinutes = getMinuteBounds(constraints.recoverySeconds)
  const spindleSensorCode = constraints.spindleSensorCode || DEFAULT_SPINDLE_SENSOR_CODE
  const stallBounds = getRotationStallSecondsBounds(constraints.rotationStallMs)
  const requireStallValidation = Boolean(constraints.rotationStallMs)

  for (const sensorCode of constraints.sensorCodes) {
    const threshold = thresholds[sensorCode]
    if (!threshold) {
      errors[sensorCode] = 'Sensor settings are missing.'
      continue
    }
    if (sensorCode === constraints.outputSensorCode && threshold.absenceDetectionEnabled) {
      errors[sensorCode] = 'Production output sensing cannot use absence detection.'
      continue
    }
    let stallError = null
    let triggerError = null
    let recoveryError = null

    if (sensorCode === spindleSensorCode && (requireStallValidation || threshold.rotationStallMs !== undefined)) {
      if (!Number.isInteger(threshold.rotationStallMs)
        || threshold.rotationStallMs < stallBounds.minimumMs
        || threshold.rotationStallMs > stallBounds.maximumMs) {
        stallError = `Rotation stall must be ${stallBounds.minimum}-${stallBounds.maximum} seconds.`
      } else if (threshold.rotationStallMs % 100 !== 0) {
        stallError = 'Rotation stall must use 0.1-second steps.'
      }
    }
    if (threshold.absenceDetectionEnabled) {
      if (!Number.isInteger(threshold.triggerSeconds)
        || threshold.triggerSeconds % 60 !== 0
        || threshold.triggerSeconds < triggerMinutes.minimumWhenEnabled * 60
        || threshold.triggerSeconds > triggerMinutes.maximum * 60) {
        triggerError = `Trigger must be ${formatMinuteRange(triggerMinutes)}.`
      }
      if (!Number.isInteger(threshold.recoverySeconds)
        || threshold.recoverySeconds % 60 !== 0
        || threshold.recoverySeconds < recoveryMinutes.minimumWhenEnabled * 60
        || threshold.recoverySeconds > recoveryMinutes.maximum * 60) {
        recoveryError = `Recovery must be ${formatMinuteRange(recoveryMinutes)}.`
      }
      if (!stallError
        && !triggerError
        && !recoveryError
        && sensorCode === spindleSensorCode
        && threshold.rotationStallMs !== undefined
        && threshold.rotationStallMs >= threshold.triggerSeconds * 1000) {
        stallError = 'Rotation stall must be shorter than the trigger limit.'
      }
    }

    if (stallError) {
      errors[`${sensorCode}.rotationStallMs`] = stallError
    }
    if (triggerError) {
      errors[`${sensorCode}.triggerSeconds`] = triggerError
    }
    if (recoveryError) {
      errors[`${sensorCode}.recoverySeconds`] = recoveryError
    }
    const primarySensorError = triggerError || recoveryError || stallError
    if (primarySensorError) {
      errors[sensorCode] = primarySensorError
    }
  }

  const schedule = settings?.shiftSchedule
  if (!schedule) return { ...errors, schedule: 'Shift schedule is missing.' }
  const workStart = toMinutes(schedule.workStart)
  const workEnd = toMinutes(schedule.workEnd)
  if (workStart === null || workEnd === null || workStart >= workEnd) {
    errors.schedule = 'Work end must be later than work start on the same day.'
  }
  if (!Number.isInteger(schedule.rampUpGraceMinutes)
    || schedule.rampUpGraceMinutes < constraints.rampUpGraceMinutes.minimum
    || schedule.rampUpGraceMinutes > constraints.rampUpGraceMinutes.maximum) {
    errors.rampUpGraceMinutes = `Grace period must be ${constraints.rampUpGraceMinutes.minimum}-${constraints.rampUpGraceMinutes.maximum} minutes.`
  }
  const restDays = schedule.restDays ?? []
  const maxRestDays = constraints?.restDays?.maximum ?? 6
  if (!Array.isArray(restDays)) {
    errors.restDays = 'Weekly rest days must be a list of weekdays.'
  } else {
    const seenRestDays = new Set()
    const invalidDay = restDays.some((day) => typeof day !== 'string' || !WEEKDAYS.includes(day))
    const hasDuplicate = restDays.some((day) => {
      if (seenRestDays.has(day)) return true
      seenRestDays.add(day)
      return false
    })
    if (invalidDay || hasDuplicate) {
      errors.restDays = 'Weekly rest days must contain valid, unique weekdays.'
    } else if (restDays.length > maxRestDays) {
      errors.restDays = 'At least one working day per week is required.'
    }
  }
  if (!Array.isArray(schedule.breaks) || schedule.breaks.length > constraints.breaks.maximum) {
    errors.breaks = `At most ${constraints.breaks.maximum} breaks are allowed.`
    return errors
  }

  const breakEval = evaluateBreaks(schedule, constraints)
  if (breakEval.errorMessage) {
    errors.breaks = breakEval.errorMessage
  }
  return errors
}

function normalizeSettingsForComparison(value) {
  if (!value || typeof value !== 'object') return value
  const copy = cloneSettings(value)
  if (copy.shiftSchedule && typeof copy.shiftSchedule === 'object') {
    copy.shiftSchedule.restDays = normalizeRestDays(copy.shiftSchedule.restDays)
  }
  return copy
}

export function settingsAreEqual(left, right) {
  if (!left || !right) return left === right
  return JSON.stringify(normalizeSettingsForComparison(left)) === JSON.stringify(normalizeSettingsForComparison(right))
}

export function getManilaToday(asOf = new Date()) {
  const date = asOf instanceof Date ? asOf : new Date(asOf)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

export function addBusinessDays(dateKey, days) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return ''
  const [year, month, day] = dateKey.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1, day + days))
  if (Number.isNaN(target.getTime())) return ''
  return target.toISOString().slice(0, 10)
}

function getWeekdayForDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const dayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return WEEKDAYS[dayIndex]
}

export function formatBusinessDateDisplay(dateKey) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return ''
  const [year, month, day] = dateKey.split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(utcDate.getTime())) return dateKey
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate)
}

export function getBackToWorkDate(endDate, restDays = [], calendarDays = []) {
  if (typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null
  const restDaySet = new Set(normalizeRestDays(restDays))
  const calendarLookup = new Map()

  if (Array.isArray(calendarDays)) {
    for (const entry of calendarDays) {
      const dateKey = entry?.calendarDate ?? entry?.calendar_date
      const isWorking = entry?.isWorking ?? entry?.is_working
      if (typeof dateKey === 'string' && typeof isWorking === 'boolean') {
        calendarLookup.set(dateKey, isWorking)
      }
    }
  }

  for (let offset = 1; offset <= 370; offset += 1) {
    const candidate = addBusinessDays(endDate, offset)
    if (!candidate) return null
    if (calendarLookup.has(candidate)) {
      if (calendarLookup.get(candidate) === true) return candidate
      continue
    }
    if (!restDaySet.has(getWeekdayForDateKey(candidate))) {
      return candidate
    }
  }
  return null
}

// Group multi-day exclusions sharing a groupId so ranges display as one compact row.
export function groupCalendarEntries(entries = [], manilaToday = getManilaToday()) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  const groupBuckets = new Map()
  const standaloneRows = []

  for (const entry of entries) {
    if (!entry || !entry.calendarDate) continue
    if (entry.groupId) {
      const bucket = groupBuckets.get(entry.groupId) || []
      bucket.push(entry)
      groupBuckets.set(entry.groupId, bucket)
    } else {
      const isFuture = entry.calendarDate > manilaToday
      standaloneRows.push({
        key: `day:${entry.calendarDate}`,
        isRangeGroup: false,
        groupId: null,
        entry,
        entries: [entry],
        startDate: entry.calendarDate,
        endDate: entry.calendarDate,
        dayCount: 1,
        name: entry.name,
        dayType: entry.dayType,
        isWorking: entry.isWorking,
        reason: entry.reason || null,
        source: entry.source,
        hasFutureDates: isFuture,
        isAllLocked: !isFuture,
      })
    }
  }

  const groupedRows = []
  for (const [groupId, bucket] of groupBuckets.entries()) {
    const sortedEntries = [...bucket].sort((left, right) => left.calendarDate.localeCompare(right.calendarDate))
    const first = sortedEntries[0]
    const last = sortedEntries[sortedEntries.length - 1]
    const hasFutureDates = sortedEntries.some((item) => item.calendarDate > manilaToday)
    groupedRows.push({
      key: `group:${groupId}`,
      isRangeGroup: true,
      groupId,
      entry: sortedEntries.find((item) => item.calendarDate > manilaToday) || first,
      entries: sortedEntries,
      startDate: first.calendarDate,
      endDate: last.calendarDate,
      dayCount: sortedEntries.length,
      name: first.name,
      dayType: first.dayType,
      isWorking: first.isWorking,
      reason: first.reason || null,
      source: first.source,
      hasFutureDates,
      isAllLocked: !hasFutureDates,
    })
  }

  return [...standaloneRows, ...groupedRows].sort((left, right) => (
    left.startDate.localeCompare(right.startDate)
  ))
}
