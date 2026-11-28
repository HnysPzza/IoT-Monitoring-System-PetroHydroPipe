const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const { isEligibleAt } = require('../../shared/operationalTime')
const { addBusinessDays, formatBusinessDate } = require('../../shared/businessTime')
const { getMachineRecord, pruneExpiredMapEntries } = require('./iot.helpers')

const MAX_DEVICE_THRESHOLDS_CACHE_ENTRIES = 16
const DEVICE_THRESHOLDS_CACHE_TTL_MS = 5_000
const deviceThresholdsCache = new Map()
// ponytail: process-local in-flight map; share via cache or lock if multi-instance.
const deviceThresholdsInFlight = new Map()

function invalidateDeviceThresholdsCache(machineId) {
  if (machineId) {
    deviceThresholdsCache.delete(machineId)
    for (const key of deviceThresholdsInFlight.keys()) {
      if (key.startsWith(`${machineId}:`)) deviceThresholdsInFlight.delete(key)
    }
    return
  }
  deviceThresholdsCache.clear()
  deviceThresholdsInFlight.clear()
}

async function getDeviceOperationalThresholds(sensor, { useCache = false, asOf = new Date() } = {}) {
  const supabase = getSupabaseClient()
  if (!sensor || typeof supabase?.from !== 'function') return null
  const machine = getMachineRecord(sensor)
  const machineId = sensor.machine_id || machine?.id
  if (!machineId || !sensor.sensor_code) return null

  try {
    const now = Date.now()
    const asOfDate = asOf instanceof Date ? asOf : new Date(asOf)
    const asOfDay = formatBusinessDate(asOfDate)
    const windowStart = formatBusinessDate(addBusinessDays(asOfDate, -1))
    const windowEnd = formatBusinessDate(addBusinessDays(asOfDate, 1))
    const inFlightKey = `${machineId}:${asOfDay}`
    let data = null
    if (useCache) {
      const cached = deviceThresholdsCache.get(machineId)
      if (cached && cached.expiresAt > now && asOfDay >= cached.windowStart && asOfDay <= cached.windowEnd) {
        data = cached.data
      } else if (cached) {
        deviceThresholdsCache.delete(machineId)
      }
    }

    const loadThresholds = async () => {
      const { data: queriedData, error } = await supabase
        .from('machine_operational_settings')
        .select('sensor_thresholds, shift_schedule, version')
        .eq('machine_id', machineId)
        .maybeSingle()

      if (error || !queriedData?.sensor_thresholds) return null

      let calendarDays = []
      let calendarErrorFlag = false
      if (queriedData.shift_schedule && typeof queriedData.shift_schedule === 'object') {
        try {
          const { data: calendarData, error: calendarError } = await supabase
            .from('production_calendar_days')
            .select('calendar_date, is_working')
            .eq('machine_id', machineId)
            .gte('calendar_date', windowStart)
            .lte('calendar_date', windowEnd)
          if (calendarError) {
            calendarErrorFlag = true
          } else if (Array.isArray(calendarData)) {
            calendarDays = calendarData
          }
        } catch {
          calendarDays = []
          calendarErrorFlag = true
        }
      }

      const loaded = {
        ...queriedData,
        calendar_days: calendarDays,
        calendar_error: calendarErrorFlag,
      }
      if (!calendarErrorFlag) {
        const cachedAt = Date.now()
        pruneExpiredMapEntries(deviceThresholdsCache, cachedAt, MAX_DEVICE_THRESHOLDS_CACHE_ENTRIES)
        deviceThresholdsCache.set(machineId, {
          data: loaded,
          windowStart,
          windowEnd,
          expiresAt: cachedAt + DEVICE_THRESHOLDS_CACHE_TTL_MS,
        })
      }
      return loaded
    }

    if (!data) {
      if (useCache) {
        let pending = deviceThresholdsInFlight.get(inFlightKey)
        if (!pending) {
          pending = loadThresholds().finally(() => {
            if (deviceThresholdsInFlight.get(inFlightKey) === pending) {
              deviceThresholdsInFlight.delete(inFlightKey)
            }
          })
          deviceThresholdsInFlight.set(inFlightKey, pending)
        }
        data = await pending
      } else {
        data = await loadThresholds()
      }
      if (!data) return null
    }

    const threshold = data.sensor_thresholds[sensor.sensor_code]
    if (!threshold || typeof threshold !== 'object') return null

    const triggerSeconds = Number.isInteger(threshold.triggerSeconds)
      && threshold.triggerSeconds >= 1
      && threshold.triggerSeconds <= 3600
      ? threshold.triggerSeconds
      : null
    const recoverySeconds = Number.isInteger(threshold.recoverySeconds)
      && threshold.recoverySeconds >= 1
      && threshold.recoverySeconds <= 300
      ? threshold.recoverySeconds
      : null
    const scheduleEligible = data.shift_schedule && typeof data.shift_schedule === 'object'
      ? isEligibleAt({
        at: asOf,
        settingsHistory: [{
          version: data.version ?? 1,
          shift_schedule: data.shift_schedule,
          effective_from: null,
          effective_to: null,
        }],
        calendarDays: data.calendar_days || [],
      })
      : true
    const absenceDetectionEnabled = env.WATCHDOG_MODE === 'enforce'
      && !data.calendar_error
      && scheduleEligible
      && Boolean(threshold.absenceDetectionEnabled)
      && sensor.sensor_code !== 'S-05'
      && triggerSeconds !== null
      && recoverySeconds !== null
    const rotationStallMs = sensor.sensor_code === 'S-03'
      ? (Number.isInteger(threshold.rotationStallMs)
        && threshold.rotationStallMs >= 500
        && threshold.rotationStallMs <= 30000
        ? threshold.rotationStallMs
        : 3000)
      : null

    return {
      sensorCode: sensor.sensor_code,
      machineCode: machine?.machine_code || null,
      version: data.version !== undefined && data.version !== null ? String(data.version) : null,
      absenceDetectionEnabled,
      triggerSeconds,
      recoverySeconds,
      ...(rotationStallMs !== null ? { rotationStallMs } : {}),
    }
  } catch {
    return null
  }
}

module.exports = {
  getDeviceOperationalThresholds,
  invalidateDeviceThresholdsCache,
}
