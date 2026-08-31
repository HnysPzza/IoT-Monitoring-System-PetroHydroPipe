const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const { OUTPUT_SENSOR_CODE } = require('../../shared/sensorIdentity')
const {
  SENSOR_CODES,
  SETTINGS_LIMITS,
  completeSettingsSchema,
  storedSettingsRecordSchema,
} = require('./settings.model')

function createSettingsError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function normalizeVersion(version, errorCode) {
  if (typeof version === 'string' && /^[1-9]\d*$/.test(version)) {
    return version
  }

  if (typeof version === 'number' && Number.isSafeInteger(version) && version > 0) {
    return String(version)
  }

  throw createSettingsError(500, errorCode, 'Machine settings contain an invalid version.')
}

function parseSettingsDocument(record, errorCode, expectedMachineId) {
  const parsed = storedSettingsRecordSchema.safeParse(record)

  if (!parsed.success || parsed.data.machine_id !== expectedMachineId) {
    throw createSettingsError(500, errorCode, 'Machine settings are invalid.')
  }

  return {
    machineId: parsed.data.machine_id,
    timeZone: 'Asia/Manila',
    sensorThresholds: parsed.data.sensor_thresholds,
    shiftSchedule: parsed.data.shift_schedule,
    version: normalizeVersion(parsed.data.version, errorCode),
    updatedAt: parsed.data.updated_at,
    updatedBy: parsed.data.updated_by,
  }
}

function validateWatchdogCapability(sensorThresholds) {
  for (const [sensorCode, threshold] of Object.entries(sensorThresholds)) {
    if (!threshold.absenceDetectionEnabled) continue

    if ((threshold.triggerSeconds * 1000) < env.IOT_HEARTBEAT_EXPECTED_INTERVAL_MS) {
      throw createSettingsError(
        400,
        'WATCHDOG_TRIGGER_UNMEASURABLE',
        `${sensorCode} trigger must be at least one heartbeat interval.`,
      )
    }

    if ((threshold.recoverySeconds * 1000) < (env.IOT_HEARTBEAT_EXPECTED_INTERVAL_MS * 2)) {
      throw createSettingsError(
        400,
        'WATCHDOG_RECOVERY_UNMEASURABLE',
        `${sensorCode} recovery must allow at least two heartbeat observations.`,
      )
    }
  }
}

function getSettingsConstraints() {
  return {
    sensorCodes: SENSOR_CODES,
    outputSensorCode: OUTPUT_SENSOR_CODE,
    triggerSeconds: {
      ...SETTINGS_LIMITS.triggerSeconds,
      minimumWhenEnabled: Math.max(
        SETTINGS_LIMITS.triggerSeconds.minimum,
        Math.ceil(env.IOT_HEARTBEAT_EXPECTED_INTERVAL_MS / 1000),
      ),
    },
    recoverySeconds: {
      ...SETTINGS_LIMITS.recoverySeconds,
      minimumWhenEnabled: Math.max(
        SETTINGS_LIMITS.recoverySeconds.minimum,
        Math.ceil((env.IOT_HEARTBEAT_EXPECTED_INTERVAL_MS * 2) / 1000),
      ),
    },
    breaks: SETTINGS_LIMITS.breaks,
    rampUpGraceMinutes: SETTINGS_LIMITS.rampUpGraceMinutes,
    sameDayShiftOnly: true,
    timeZone: 'Asia/Manila',
  }
}

async function loadMachine(supabase, machineId) {
  const { data, error } = await supabase
    .from('machines')
    .select('id')
    .eq('id', machineId)
    .maybeSingle()

  if (error) {
    throw createSettingsError(500, 'SETTINGS_QUERY_FAILED', 'Unable to load machine settings.')
  }

  if (!data) {
    throw createSettingsError(404, 'MACHINE_NOT_FOUND', 'Machine not found.')
  }
}

async function getMachineSettings(machineId, suppliedClient) {
  const supabase = suppliedClient || getSupabaseClient()
  await loadMachine(supabase, machineId)

  const { data, error } = await supabase
    .from('machine_operational_settings')
    .select('machine_id, sensor_thresholds, shift_schedule, version, updated_at, updated_by')
    .eq('machine_id', machineId)
    .maybeSingle()

  if (error) {
    throw createSettingsError(500, 'SETTINGS_QUERY_FAILED', 'Unable to load machine settings.')
  }

  if (!data) {
    throw createSettingsError(
      500,
      'SETTINGS_NOT_CONFIGURED',
      'Machine settings are not configured.',
    )
  }

  return parseSettingsDocument(data, 'SETTINGS_QUERY_FAILED', machineId)
}

function mapUpdateError(error) {
  if (error?.code === '40001') {
    return createSettingsError(
      409,
      'SETTINGS_VERSION_CONFLICT',
      'Machine settings were updated by another request.',
    )
  }

  if (error?.code === 'P0002') {
    return createSettingsError(404, 'MACHINE_NOT_FOUND', 'Machine not found.')
  }

  if (error?.code === '55000') {
    return createSettingsError(
      500,
      'SETTINGS_NOT_CONFIGURED',
      'Machine settings are not configured.',
    )
  }

  return createSettingsError(500, 'SETTINGS_UPDATE_FAILED', 'Unable to update machine settings.')
}

async function updateMachineSettings({
  machineId,
  expectedVersion,
  sensorThresholds,
  shiftSchedule,
  actorUserId,
}) {
  if (env.WATCHDOG_MODE === 'enforce') {
    throw createSettingsError(
      409,
      'SETTINGS_ENFORCEMENT_ACTIVE',
      'Disable enforcement before changing operational settings.',
    )
  }

  const supabase = getSupabaseClient()
  const current = await getMachineSettings(machineId, supabase)
  const candidate = {
    sensorThresholds: sensorThresholds === undefined
      ? current.sensorThresholds
      : { ...current.sensorThresholds, ...sensorThresholds },
    shiftSchedule: shiftSchedule === undefined ? current.shiftSchedule : shiftSchedule,
  }
  const parsed = completeSettingsSchema.safeParse(candidate)

  if (!parsed.success) {
    throw createSettingsError(400, 'VALIDATION_ERROR', 'Machine settings are invalid.')
  }
  validateWatchdogCapability(parsed.data.sensorThresholds)

  const { data, error } = await supabase
    .rpc('update_machine_operational_settings', {
      p_machine_id: machineId,
      p_expected_version: expectedVersion,
      p_sensor_thresholds: parsed.data.sensorThresholds,
      p_shift_schedule: parsed.data.shiftSchedule,
      p_actor_user_id: actorUserId,
    })
    .maybeSingle()

  if (error) {
    throw mapUpdateError(error)
  }

  if (!data) {
    throw createSettingsError(500, 'SETTINGS_UPDATE_FAILED', 'Unable to update machine settings.')
  }

  return parseSettingsDocument(data, 'SETTINGS_UPDATE_FAILED', machineId)
}

module.exports = {
  getSettingsConstraints,
  getMachineSettings,
  updateMachineSettings,
}
