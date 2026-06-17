const { getSupabaseClient } = require('../../database/client')
const { getSensorLabel, getSensorPurpose } = require('../../shared/sensorIdentity')
const { recordAuditLog } = require('../audit/audit.service')

function createMachineError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function toMachineResponse(machineRecord) {
  return {
    id: machineRecord.id,
    machineCode: machineRecord.machine_code,
    name: machineRecord.name,
    status: machineRecord.status,
    location: machineRecord.location,
    sensorCount: Number(machineRecord.sensors?.[0]?.count || 0),
    createdAt: machineRecord.created_at,
    updatedAt: machineRecord.updated_at,
  }
}

function toSensorResponse(sensorRecord) {
  return {
    id: sensorRecord.id,
    sensorCode: sensorRecord.sensor_code,
    esp32DeviceId: sensorRecord.esp32_device_id,
    label: getSensorLabel(sensorRecord.sensor_code, sensorRecord.label),
    purpose: getSensorPurpose(sensorRecord.sensor_code),
    status: sensorRecord.status,
    machineId: sensorRecord.machine_id,
    createdAt: sensorRecord.created_at,
    updatedAt: sensorRecord.updated_at,
  }
}

async function listMachines() {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('machines')
    .select(`
      id,
      machine_code,
      name,
      status,
      location,
      created_at,
      updated_at,
      sensors(count)
    `)
    .order('machine_code', { ascending: true })

  if (error) {
    throw createMachineError(500, 'MACHINES_QUERY_FAILED', 'Unable to load machines.')
  }

  return data.map(toMachineResponse)
}

async function listSensorsByMachine(machineId) {
  const supabase = getSupabaseClient()

  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('id')
    .eq('id', machineId)
    .maybeSingle()

  if (machineError) {
    throw createMachineError(500, 'MACHINE_QUERY_FAILED', 'Unable to load machine.')
  }

  if (!machine) {
    throw createMachineError(404, 'MACHINE_NOT_FOUND', 'Machine not found.')
  }

  const { data, error } = await supabase
    .from('sensors')
    .select('id, sensor_code, esp32_device_id, label, status, machine_id, created_at, updated_at')
    .eq('machine_id', machineId)
    .order('sensor_code', { ascending: true })

  if (error) {
    throw createMachineError(500, 'SENSORS_QUERY_FAILED', 'Unable to load machine sensors.')
  }

  return data.map(toSensorResponse)
}

async function updateMachineStatus({ machineId, status, actorUserId }) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('machines')
    .update({ status })
    .eq('id', machineId)
    .select(`
      id,
      machine_code,
      name,
      status,
      location,
      created_at,
      updated_at,
      sensors(count)
    `)
    .maybeSingle()

  if (error) {
    throw createMachineError(500, 'MACHINE_STATUS_UPDATE_FAILED', 'Unable to update machine status.')
  }

  if (!data) {
    throw createMachineError(404, 'MACHINE_NOT_FOUND', 'Machine not found.')
  }

  const machine = toMachineResponse(data)
  await recordAuditLog({
    userId: actorUserId,
    action: 'MACHINE_STATUS_UPDATED',
    entityType: 'machine',
    entityId: machine.id,
    metadata: {
      machineCode: machine.machineCode,
      machineName: machine.name,
      newStatus: machine.status,
    },
  })

  return machine
}

async function updateSensorStatus({ sensorId, status, actorUserId }) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('sensors')
    .update({ status })
    .eq('id', sensorId)
    .select('id, sensor_code, esp32_device_id, label, status, machine_id, created_at, updated_at')
    .maybeSingle()

  if (error) {
    throw createMachineError(500, 'SENSOR_STATUS_UPDATE_FAILED', 'Unable to update sensor status.')
  }

  if (!data) {
    throw createMachineError(404, 'SENSOR_NOT_FOUND', 'Sensor not found.')
  }

  const sensor = toSensorResponse(data)
  await recordAuditLog({
    userId: actorUserId,
    action: 'SENSOR_STATUS_UPDATED',
    entityType: 'sensor',
    entityId: sensor.id,
    metadata: {
      sensorCode: sensor.sensorCode,
      esp32DeviceId: sensor.esp32DeviceId,
      newStatus: sensor.status,
    },
  })

  return sensor
}

module.exports = {
  listMachines,
  listSensorsByMachine,
  toMachineResponse,
  toSensorResponse,
  updateMachineStatus,
  updateSensorStatus,
}
