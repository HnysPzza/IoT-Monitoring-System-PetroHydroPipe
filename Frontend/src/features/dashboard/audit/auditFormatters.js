import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import { cleanCode, formatDateTime as formatSharedDateTime } from '../../../shared/utils/formatters.js'
import { getSignalLabel } from '../../../shared/utils/signalFormatters.js'

const actionLabels = {
  LOGIN_SUCCESS: 'Successful login',
  LOGIN_FAILED: 'Failed login attempt',
  USER_CREATED: 'User account created',
  USER_STATUS_UPDATED: 'User account status changed',
  USER_ARCHIVED: 'User account archived',
  DOWNTIME_UPDATED: 'Downtime record updated',
  MACHINE_STATUS_UPDATED: 'Machine status changed',
  SENSOR_STATUS_UPDATED: 'Sensor status changed',
  IOT_EVENT_RECEIVED: 'Sensor event received',
  IOT_DEVICE_AUTH_FAILED: 'ESP32 device rejected',
  IOT_MACHINE_STATUS_UPDATED: 'Machine status updated by sensor data',
}

export const auditActionOptions = [
  { value: 'All', label: 'All actions' },
  ...Object.entries(actionLabels).map(([value, label]) => ({ value, label })),
]

const entityLabels = {
  auth: 'Authentication',
  user: 'User account',
  machine: 'Machine',
  sensor: 'Sensor',
  iot_device: 'ESP32 device',
  sensor_event: 'Sensor event',
  downtime: 'Downtime record',
}

export const auditEntityOptions = [
  { value: 'All', label: 'All records' },
  ...Object.entries(entityLabels).map(([value, label]) => ({ value, label })),
]

const loginFailureReasons = {
  invalid_credentials: 'the username or password was incorrect',
  inactive_account: 'the account is inactive',
  archived_account: 'the account has been archived',
}

function getSensorName(sensorCode) {
  if (!sensorCode) {
    return null
  }

  return formatSensorName(sensorCode)
}

function getMachineName(log) {
  return log.metadata?.machineCode || 'Spiral Mill 01'
}

export function formatDateTime(value) {
  return formatSharedDateTime(value)
}

export function getReadableAction(log) {
  return actionLabels[log.action] || 'System action recorded'
}

export function getReadableEntity(log) {
  return entityLabels[log.entityType] || cleanCode(log.entityType)
}

export function getReadableActor(log) {
  if (log.actor) {
    const name = log.actor.name || log.actor.username || 'User'
    return log.actor.role ? `${name} (${log.actor.role})` : name
  }

  if (log.metadata?.deviceId) {
    return log.metadata.deviceId
  }

  return 'System / device'
}

export function getReadableTarget(log) {
  if (log.entityType === 'auth') {
    return log.metadata?.username || 'Login'
  }

  if (log.entityType === 'user') {
    return log.metadata?.targetUsername || 'User account'
  }

  if (log.entityType === 'machine') {
    return getMachineName(log)
  }

  if (log.entityType === 'sensor') {
    return getSensorName(log.metadata?.sensorCode) || 'Sensor'
  }

  if (log.entityType === 'iot_device') {
    return log.metadata?.deviceId || 'ESP32 device'
  }

  if (log.entityType === 'sensor_event') {
    return getSensorName(log.metadata?.sensorCode) || 'Sensor event'
  }

  return log.metadata?.username || getReadableEntity(log)
}

export function getReadableDetails(log) {
  const metadata = log.metadata || {}
  const username = metadata.username || 'User'
  const role = metadata.role || 'assigned role'
  const targetUser = metadata.targetUsername || 'User account'
  const targetRole = metadata.targetRole ? ` as ${metadata.targetRole}` : ''
  const status = metadata.newStatus || 'updated'
  const sensor = getSensorName(metadata.sensorCode) || 'Sensor'
  const signal = getSignalLabel(metadata.signal)
  const eventType = cleanCode(metadata.eventType).toLowerCase()

  switch (log.action) {
    case 'LOGIN_SUCCESS':
      return `${username} logged in as ${role}.`
    case 'LOGIN_FAILED':
      return `Login failed for ${username} because ${loginFailureReasons[metadata.reason] || 'the request was rejected'}.`
    case 'USER_CREATED':
      return `${targetUser} was created${targetRole}.`
    case 'USER_STATUS_UPDATED':
      return `${targetUser} was changed to ${status}.`
    case 'USER_ARCHIVED':
      return `${targetUser} was archived and can no longer log in.`
    case 'DOWNTIME_UPDATED':
      return `Downtime record was updated to ${metadata.status || 'reviewed'} with cause ${metadata.cause || 'not set'}.`
    case 'MACHINE_STATUS_UPDATED':
      return `${getMachineName(log)} changed to ${status}.`
    case 'SENSOR_STATUS_UPDATED':
      return `${sensor} changed to ${status}.`
    case 'IOT_EVENT_RECEIVED':
      return `${sensor} detected ${eventType}. Signal: ${signal}.`
    case 'IOT_DEVICE_AUTH_FAILED':
      return `${metadata.deviceId || 'ESP32 device'} was rejected because ${loginFailureReasons[metadata.reason] || cleanCode(metadata.reason).toLowerCase()}.`
    case 'IOT_MACHINE_STATUS_UPDATED':
      return `${getMachineName(log)} changed to ${status} from ESP32 sensor data.`
    default:
      return 'System action was recorded.'
  }
}

export function getReadableSource(log) {
  if (log.action?.startsWith('IOT_') || log.metadata?.deviceId || log.metadata?.source === 'esp32_event') {
    return 'ESP32 sensor data'
  }

  if (log.entityType === 'auth') {
    return 'Login system'
  }

  if (log.actor) {
    return 'Dashboard user'
  }

  return 'System'
}
