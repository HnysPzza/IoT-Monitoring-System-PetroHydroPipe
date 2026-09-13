import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import { cleanCode, formatDateTime as formatSharedDateTime } from '../../../shared/utils/formatters.js'
import { getSignalLabel } from '../../../shared/utils/signalFormatters.js'

const actionLabels = {
  WATCHDOG_DOWNTIME_CREATED: 'Sensor monitoring confirmed downtime',
  WATCHDOG_DOWNTIME_RESOLVED: 'Sensor monitoring confirmed recovery',
  CONNECTIVITY_ALERT_CREATED: 'Sensor connection lost',
  CONNECTIVITY_ALERT_RESOLVED: 'Sensor connection restored',
  LOGIN_SUCCESS: 'Successful login',
  LOGIN_FAILED: 'Failed login attempt',
  USER_CREATED: 'User account created',
  USER_STATUS_UPDATED: 'User account status changed',
  USER_ARCHIVED: 'User account archived',
  DOWNTIME_CREATED: 'Downtime record created',
  DOWNTIME_AUTO_RESOLVED: 'Downtime automatically resolved',
  DOWNTIME_UPDATED: 'Downtime record updated',
  MACHINE_STATUS_UPDATED: 'Machine status changed',
  SENSOR_STATUS_UPDATED: 'Sensor status changed',
  SENSOR_MANUAL_RECOVERY_OVERRIDE: 'Manual sensor recovery override',
  IOT_EVENT_RECEIVED: 'Sensor event received',
  IOT_DEVICE_AUTH_FAILED: 'Sensor device rejected',
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
  auth: 'Login',
  user: 'User account',
  machine: 'Machine',
  sensor: 'Sensor',
  iot_device: 'Sensor device',
  sensor_event: 'Sensor activity',
  downtime: 'Downtime',
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
  return log.metadata?.machineName || log.metadata?.machineCode || 'Spiral Mill 01'
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
    return log.actor.role || 'User'
  }

  if (isSensorActivity(log)) {
    return 'Sensors'
  }

  if (log.entityType === 'auth') {
    return 'User'
  }

  return 'System'
}

export function getReadableTarget(log) {
  if (log.entityType === 'auth') {
    return 'Login'
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
    return 'Sensor device'
  }

  if (log.entityType === 'sensor_event') {
    return getSensorName(log.metadata?.sensorCode) || 'Sensor event'
  }

  return log.metadata?.username || getReadableEntity(log)
}

export function getReadableDetails(log) {
  const metadata = log.metadata || {}
  const targetUser = metadata.targetUsername || 'User account'
  const targetRole = metadata.targetRole ? ` as ${metadata.targetRole}` : ''
  const status = metadata.newStatus || 'updated'
  const sensor = getSensorName(metadata.sensorCode) || 'Sensor'
  const signal = getSignalLabel(metadata.signal)
  const eventType = cleanCode(metadata.eventType).toLowerCase()
  const isNoPulseObservation = metadata.eventType === 'downtime' && metadata.signal === 'no_pulse'

  switch (log.action) {
    case 'WATCHDOG_DOWNTIME_CREATED':
      return `${getSensorName(metadata.ownerSensorCode) || sensor} downtime was confirmed after the configured absence threshold.`
    case 'WATCHDOG_DOWNTIME_RESOLVED':
      return `${getSensorName(metadata.ownerSensorCode) || sensor} recovered after the configured recovery confirmation.`
    case 'CONNECTIVITY_ALERT_CREATED':
      return `${sensor} is offline. Communication loss alone does not confirm downtime.`
    case 'CONNECTIVITY_ALERT_RESOLVED':
      return `${sensor} reconnected. Physical fault recovery is checked separately.`
    case 'LOGIN_SUCCESS':
      return 'Login was successful.'
    case 'LOGIN_FAILED':
      return `Login failed because ${loginFailureReasons[metadata.reason] || 'the request was rejected'}.`
    case 'USER_CREATED':
      return `${targetUser} was created${targetRole}.`
    case 'USER_STATUS_UPDATED':
      return `${targetUser} was changed to ${status}.`
    case 'USER_ARCHIVED':
      return `${targetUser} was archived and can no longer log in.`
    case 'DOWNTIME_CREATED': {
      const cause = metadata.cause || 'Pending Cause Review'
      return cause === 'Pending Cause Review'
        ? `Downtime record was created for ${sensor}. Cause needs review.`
        : `Downtime record was created for ${sensor} with cause ${cause}.`
    }
    case 'DOWNTIME_AUTO_RESOLVED':
      return `Downtime record for ${sensor} was automatically resolved after sensor recovery.`
    case 'DOWNTIME_UPDATED':
      return `Downtime record was updated to ${metadata.status || 'reviewed'} with cause ${metadata.cause || 'not set'}.`
    case 'MACHINE_STATUS_UPDATED':
      return `${getMachineName(log)} changed to ${status}.`
    case 'SENSOR_STATUS_UPDATED':
      return `${sensor} changed to ${status}.`
    case 'SENSOR_MANUAL_RECOVERY_OVERRIDE':
      return `${sensor} was manually recovered because ${metadata.reason || 'an authorized override was recorded'}. ${getMachineName(log)} was recalculated to ${metadata.newMachineStatus || 'its derived status'}.`
    case 'IOT_EVENT_RECEIVED':
      if (isNoPulseObservation) {
        return `${sensor} reported no pulse. This is an observation, not confirmed downtime.`
      }
      return `${sensor} detected ${eventType}. Signal: ${signal}.`
    case 'IOT_DEVICE_AUTH_FAILED':
      return `A sensor device was rejected because ${loginFailureReasons[metadata.reason] || cleanCode(metadata.reason).toLowerCase()}.`
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
  if (isSensorActivity(log)) {
    return 'Sensors'
  }

  if (log.entityType === 'auth') {
    return 'Login'
  }

  if (log.actor) {
    return 'Dashboard'
  }

  return 'System'
}

export function getReadableDetailItems(log) {
  return [
    { label: 'What happened', value: getReadableDetails(log) },
    ...(log.action === 'SENSOR_MANUAL_RECOVERY_OVERRIDE' && log.metadata?.reason
      ? [{ label: 'Override reason', value: log.metadata.reason }]
      : []),
    { label: 'Who did it', value: getReadableActor(log) },
    { label: 'Affected item', value: getReadableTarget(log) },
    { label: 'Source', value: getReadableSource(log) },
    { label: 'Time', value: formatDateTime(log.createdAt) },
  ]
}

function isSensorActivity(log) {
  return log.action?.startsWith('WATCHDOG_')
    || log.action?.startsWith('CONNECTIVITY_')
    || log.action?.startsWith('IOT_')
    || log.metadata?.deviceId
    || log.metadata?.source === 'esp32_event'
}
