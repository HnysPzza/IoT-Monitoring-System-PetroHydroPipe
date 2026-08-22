const { getSupabaseClient } = require('../../database/client')
const { completeSettingsSchema, storedSettingsRecordSchema } = require('./settings.model')

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
  getMachineSettings,
  updateMachineSettings,
}
