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
  ALERT_CREATED: 'Alert created',
  ALERT_ACKNOWLEDGED: 'Alert acknowledged',
  ALERT_RESOLVED: 'Alert resolved',
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

const technicalLabels = {
  alertId: 'Alert ID',
  acknowledgedAfterRecovery: 'Acknowledged after recovery',
  cause: 'Cause',
  deviceId: 'ESP32 device',
  entityId: 'Entity ID',
  eventId: 'Event ID',
  eventType: 'Event type',
  machineCode: 'Machine code',
  machineName: 'Machine',
  newStatus: 'New status',
  reason: 'Reason',
  recordedAt: 'Recorded at',
  recoveredAt: 'Recovered at',
  recoveryEventId: 'Recovery event ID',
  recoveryEventType: 'Recovery event type',
  recoveryPending: 'Recovery pending',
  recoverySignal: 'Recovery signal',
  sensorCode: 'Sensor',
  sensorLabel: 'Sensor label',
  signal: 'Signal',
  source: 'Source',
  status: 'Status',
  targetRole: 'Target role',
  targetUsername: 'Target username',
  title: 'Alert title',
  username: 'Username',
}

function getSensorName(sensorCode) {
  if (!sensorCode) {
    return null
  }

  return formatSensorName(sensorCode)
}

function getMachineName(log) {
  return log.metadata?.machineName || log.metadata?.machineCode || 'Spiral Mill 01'
}

function formatMaybeDate(value) {
  if (typeof value !== 'string') {
    return null
  }

  const timestamp = Date.parse(value)

  if (Number.isNaN(timestamp) || !value.includes('T')) {
    return null
  }

  return formatDateTime(value)
}

function formatTechnicalValue(key, value) {
  if (value === null || value === undefined || value === '') {
    return 'None'
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => formatTechnicalValue(key, item)).join(', ') : 'None'
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([nestedKey, nestedValue]) => `${cleanCode(nestedKey)}: ${formatTechnicalValue(nestedKey, nestedValue)}`)
      .join('; ')
  }

  if (key.toLowerCase().includes('at')) {
    return formatMaybeDate(value) || String(value)
  }

  if (key.toLowerCase().includes('signal')) {
    return getSignalLabel(value)
  }

  if (key.toLowerCase().includes('eventtype')) {
    return cleanCode(value)
  }

  return String(value)
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
    case 'ALERT_CREATED':
      return `${metadata.title || 'An alert'} was created for ${sensor}.`
    case 'ALERT_ACKNOWLEDGED':
      return `${metadata.title || 'An alert'} was acknowledged.`
    case 'ALERT_RESOLVED':
      return metadata.reason === 'acknowledged_after_recovery'
        ? `${metadata.title || 'An alert'} was resolved after recovery was acknowledged.`
        : `${metadata.title || 'An alert'} was resolved.`
    default:
      return 'System action was recorded.'
  }
}

export function getReadableSource(log) {
  if (log.action?.startsWith('ALERT_')) {
    return 'Alert system'
  }

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

export function getReadableDetailItems(log) {
  return [
    { label: 'What happened', value: getReadableDetails(log) },
    { label: 'Who did it', value: getReadableActor(log) },
    { label: 'Affected item', value: getReadableTarget(log) },
    { label: 'Result', value: getReadableAction(log) },
    { label: 'Source', value: getReadableSource(log) },
    { label: 'Time recorded', value: formatDateTime(log.createdAt) },
  ]
}

export function getTechnicalDetailItems(log) {
  const metadataItems = Object.entries(log.metadata || {}).map(([key, value]) => ({
    label: technicalLabels[key] || cleanCode(key),
    value: formatTechnicalValue(key, value),
  }))

  return [
    { label: 'Log ID', value: log.id },
    { label: 'Action code', value: log.action },
    { label: 'Entity type', value: log.entityType || 'None' },
    { label: 'Entity ID', value: log.entityId || 'None' },
    ...metadataItems,
  ]
}
