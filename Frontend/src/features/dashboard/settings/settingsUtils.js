export function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings))
}

export function sortBreaks(breaks) {
  return [...breaks].sort((left, right) => left.startTime.localeCompare(right.startTime))
}

function toMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (hours > 23 || minutes > 59) return null
  return (hours * 60) + minutes
}

export function getMinuteBounds(secondBounds) {
  return {
    minimumWhenEnabled: Math.max(1, Math.ceil((secondBounds?.minimumWhenEnabled || 60) / 60)),
    maximum: Math.max(1, Math.floor((secondBounds?.maximum || 60) / 60)),
  }
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
    if (!threshold.absenceDetectionEnabled) continue
    if (!Number.isInteger(threshold.triggerSeconds)
      || threshold.triggerSeconds % 60 !== 0
      || threshold.triggerSeconds < triggerMinutes.minimumWhenEnabled * 60
      || threshold.triggerSeconds > triggerMinutes.maximum * 60) {
      errors[sensorCode] = `Trigger must be ${formatMinuteRange(triggerMinutes)}.`
      continue
    }
    if (!Number.isInteger(threshold.recoverySeconds)
      || threshold.recoverySeconds % 60 !== 0
      || threshold.recoverySeconds < recoveryMinutes.minimumWhenEnabled * 60
      || threshold.recoverySeconds > recoveryMinutes.maximum * 60) {
      errors[sensorCode] = `Recovery must be ${formatMinuteRange(recoveryMinutes)}.`
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
  if (!Array.isArray(schedule.breaks) || schedule.breaks.length > constraints.breaks.maximum) {
    errors.breaks = `At most ${constraints.breaks.maximum} breaks are allowed.`
    return errors
  }

  const names = new Set()
  const sorted = sortBreaks(schedule.breaks)
  sorted.forEach((entry, index) => {
    const start = toMinutes(entry.startTime)
    const end = toMinutes(entry.endTime)
    const name = entry.name.trim().toLowerCase()
    const previousEnd = index > 0 ? toMinutes(sorted[index - 1].endTime) : null
    const previousGraceEnd = previousEnd === null ? null : previousEnd + schedule.rampUpGraceMinutes
    if (!name || names.has(name) || start === null || end === null || start >= end
      || start < workStart || end > workEnd
      || end + schedule.rampUpGraceMinutes > workEnd
      || (previousGraceEnd !== null && start < previousGraceEnd)) {
      errors.breaks = 'Breaks need unique names, valid times, and no overlap inside the shift.'
    }
    names.add(name)
  })
  return errors
}

export function settingsAreEqual(left, right) {
  if (!left || !right) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}
