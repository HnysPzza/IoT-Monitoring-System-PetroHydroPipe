import { getRoleDisplayName } from '../../../shared/constants/roleLabels.js'
import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import { cleanCode, formatDateTime as formatSharedDateTime } from '../../../shared/utils/formatters.js'
import { getSignalLabel } from '../../../shared/utils/signalFormatters.js'

const actionLabels = {
  LOGIN_SUCCESS: 'Successful login',
  LOGIN_FAILED: 'Failed login attempt',
  REFRESH_TOKEN_REUSED: 'Suspicious session reuse blocked',
  USER_CREATED: 'User account created',
  USER_INVITED: 'User account invited',
  USER_INVITATION_RESENT: 'Invitation resend requested',
  USER_PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_SETUP_COMPLETED: 'Password setup completed',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET_COMPLETED: 'Password reset completed',
  USER_STATUS_UPDATED: 'User account status changed',
  USER_ARCHIVED: 'User account archived',
  WATCHDOG_DOWNTIME_CREATED: 'Sensor monitoring confirmed downtime',
  WATCHDOG_DOWNTIME_CONFIRMED: 'Sensor monitoring confirmed downtime',
  WATCHDOG_DOWNTIME_RESOLVED: 'Sensor monitoring confirmed recovery',
  CONNECTIVITY_ALERT_CREATED: 'Sensor connection lost',
  CONNECTIVITY_ALERT_RESOLVED: 'Sensor connection restored',
  IOT_EVENT_RECEIVED: 'Sensor event received',
  IOT_DEVICE_AUTH_FAILED: 'Sensor device rejected',
  IOT_MACHINE_STATUS_UPDATED: 'Machine status updated by sensor data',
  DOWNTIME_CREATED: 'Downtime record created',
  DOWNTIME_AUTO_RESOLVED: 'Downtime automatically resolved',
  DOWNTIME_UPDATED: 'Downtime record updated',
  MACHINE_STATUS_UPDATED: 'Machine status changed',
  MACHINE_STATUS_RECONCILED: 'Machine status reconciled',
  SENSOR_STATUS_UPDATED: 'Sensor status changed',
  SENSOR_MANUAL_RECOVERY_OVERRIDE: 'Manual sensor recovery override',
  ALERT_CREATED: 'Alert created',
  ALERT_ACKNOWLEDGED: 'Alert acknowledged',
  ALERT_RESOLVED: 'Alert resolved',
  PRODUCTION_SPEC_UPDATED: 'Production spec updated',
  PRODUCTION_SPEC_BATCH_UPDATED: 'Production specs batch updated',
  SETTINGS_UPDATED: 'Operational settings updated',
  REPORT_EXPORTED: 'Report exported',
}

const ACTION_GROUP_DEFINITIONS = [
  {
    label: 'Security & access',
    actions: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'REFRESH_TOKEN_REUSED'],
  },
  {
    label: 'User accounts',
    actions: [
      'USER_CREATED',
      'USER_INVITED',
      'USER_INVITATION_RESENT',
      'USER_PASSWORD_RESET_REQUESTED',
      'PASSWORD_SETUP_COMPLETED',
      'PASSWORD_CHANGED',
      'PASSWORD_RESET_COMPLETED',
      'USER_STATUS_UPDATED',
      'USER_ARCHIVED',
    ],
  },
  {
    label: 'Sensors & downtime',
    actions: [
      'WATCHDOG_DOWNTIME_CREATED',
      'WATCHDOG_DOWNTIME_CONFIRMED',
      'WATCHDOG_DOWNTIME_RESOLVED',
      'CONNECTIVITY_ALERT_CREATED',
      'CONNECTIVITY_ALERT_RESOLVED',
      'IOT_EVENT_RECEIVED',
      'IOT_DEVICE_AUTH_FAILED',
      'IOT_MACHINE_STATUS_UPDATED',
      'DOWNTIME_CREATED',
      'DOWNTIME_AUTO_RESOLVED',
      'DOWNTIME_UPDATED',
      'MACHINE_STATUS_UPDATED',
      'MACHINE_STATUS_RECONCILED',
      'SENSOR_STATUS_UPDATED',
      'SENSOR_MANUAL_RECOVERY_OVERRIDE',
    ],
  },
  {
    label: 'Alerts',
    actions: ['ALERT_CREATED', 'ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED'],
  },
  {
    label: 'Production & settings',
    actions: ['PRODUCTION_SPEC_UPDATED', 'PRODUCTION_SPEC_BATCH_UPDATED', 'SETTINGS_UPDATED', 'REPORT_EXPORTED'],
  },
]

export const auditActionGroups = ACTION_GROUP_DEFINITIONS.map((group) => ({
  label: group.label,
  options: group.actions.map((value) => ({ value, label: actionLabels[value] })),
}))

export const auditActionOptions = [
  { value: 'All', label: 'All actions' },
  ...Object.entries(actionLabels).map(([value, label]) => ({ value, label })),
]

const entityLabels = {
  auth: 'Login',
  user: 'User account',
  machine: 'Machine',
  machine_settings: 'Operational settings',
  sensor: 'Sensor',
  sensor_connectivity: 'Sensor connectivity',
  iot_device: 'Sensor device',
  sensor_event: 'Sensor activity',
  downtime: 'Downtime',
  report: 'Report',
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

const DANGER_ACTIONS = new Set([
  'LOGIN_FAILED',
  'REFRESH_TOKEN_REUSED',
  'IOT_DEVICE_AUTH_FAILED',
  'CONNECTIVITY_ALERT_CREATED',
  'WATCHDOG_DOWNTIME_CREATED',
  'WATCHDOG_DOWNTIME_CONFIRMED',
  'DOWNTIME_CREATED',
  'ALERT_CREATED',
  'USER_ARCHIVED',
])

const WARNING_ACTIONS = new Set([
  'USER_STATUS_UPDATED',
  'DOWNTIME_UPDATED',
  'MACHINE_STATUS_RECONCILED',
  'SENSOR_MANUAL_RECOVERY_OVERRIDE',
  'ALERT_ACKNOWLEDGED',
])

const SUCCESS_ACTIONS = new Set([
  'LOGIN_SUCCESS',
  'WATCHDOG_DOWNTIME_RESOLVED',
  'CONNECTIVITY_ALERT_RESOLVED',
  'DOWNTIME_AUTO_RESOLVED',
  'ALERT_RESOLVED',
  'PASSWORD_SETUP_COMPLETED',
])

export function formatDateTime(value, options = {}) {
  return formatSharedDateTime(value, 'Not available', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  })
}

export function getAuditTone(log) {
  const action = log?.action
  if (DANGER_ACTIONS.has(action)) {
    return 'danger'
  }
  if (WARNING_ACTIONS.has(action)) {
    return 'warning'
  }
  if (action === 'IOT_EVENT_RECEIVED' && log?.metadata?.eventType === 'downtime' && log?.metadata?.signal === 'no_pulse') {
    return 'warning'
  }
  if (SUCCESS_ACTIONS.has(action)) {
    return 'success'
  }
  return 'neutral'
}

export function getReadableAction(log) {
  return actionLabels[log.action] || 'System action recorded'
}

export function getReadableEntity(log) {
  return entityLabels[log.entityType] || cleanCode(log.entityType)
}

export function getReadableActor(log) {
  if (log.actor) {
    return getRoleDisplayName(log.actor.role) || 'User'
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
    return log.targetUser?.username || log.metadata?.targetUsername || 'User account'
  }

  if (log.entityType === 'machine' || log.entityType === 'machine_settings') {
    return getMachineName(log)
  }

  if (log.entityType === 'sensor' || log.entityType === 'sensor_connectivity') {
    return getSensorName(log.metadata?.sensorCode) || getReadableEntity(log)
  }

  if (log.entityType === 'iot_device') {
    return 'Sensor device'
  }

  if (log.entityType === 'sensor_event') {
    return getSensorName(log.metadata?.sensorCode) || 'Sensor event'
  }

  if (log.entityType === 'report') {
    return log.metadata?.reportCategory ? `${cleanCode(log.metadata.reportCategory)} report` : 'Report'
  }

  return log.metadata?.username || getReadableEntity(log)
}

const settingsSectionLabels = {
  sensorThresholds: 'sensor thresholds',
  shiftSchedule: 'shift schedule',
}

function formatSettingsSections(changedSections) {
  if (!Array.isArray(changedSections) || changedSections.length === 0) {
    return 'operational settings'
  }
  return changedSections
    .map((section) => {
      if (settingsSectionLabels[section]) {
        return settingsSectionLabels[section]
      }
      const spaced = String(section || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      return cleanCode(spaced).toLowerCase()
    })
    .join(', ')
}

export function getReadableDetails(log) {
  const metadata = log.metadata || {}
  const targetUser = log.targetUser?.username || metadata.targetUsername || 'User account'
  const readableRole = metadata.targetRole ? getRoleDisplayName(metadata.targetRole) : ''
  const targetRole = readableRole ? ` as ${readableRole}` : ''
  const status = metadata.newStatus || 'updated'
  const sensor = getSensorName(metadata.sensorCode) || 'Sensor'
  const signal = getSignalLabel(metadata.signal)
  const eventType = cleanCode(metadata.eventType).toLowerCase()
  const isNoPulseObservation = metadata.eventType === 'downtime' && metadata.signal === 'no_pulse'

  switch (log.action) {
    case 'WATCHDOG_DOWNTIME_CREATED':
      return `${getSensorName(metadata.ownerSensorCode) || sensor} downtime was confirmed after the configured absence threshold.`
    case 'WATCHDOG_DOWNTIME_CONFIRMED':
      return `${getSensorName(metadata.ownerSensorCode) || sensor} downtime was confirmed by automated sensor monitoring.`
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
    case 'REFRESH_TOKEN_REUSED':
      return 'A reused session token was blocked and the user session was revoked.'
    case 'USER_CREATED':
      return `${targetUser} was created${targetRole}.`
    case 'USER_INVITED':
      return `${targetUser} was invited${targetRole}.`
    case 'USER_INVITATION_RESENT':
      return `A new invitation link was requested for ${targetUser}.`
    case 'USER_PASSWORD_RESET_REQUESTED':
      return `A password reset was requested for ${targetUser}.`
    case 'PASSWORD_SETUP_COMPLETED':
      return `${targetUser} completed password setup.`
    case 'PASSWORD_CHANGED':
      return `${targetUser} changed their password.`
    case 'PASSWORD_RESET_COMPLETED':
      return `${targetUser} reset their password.`
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
    case 'MACHINE_STATUS_RECONCILED':
      return `${getMachineName(log)} status was reconciled to ${status}.`
    case 'SENSOR_STATUS_UPDATED':
      return `${sensor} changed to ${status}.`
    case 'SENSOR_MANUAL_RECOVERY_OVERRIDE':
      return `${sensor} was manually recovered. ${getMachineName(log)} was recalculated to ${metadata.newMachineStatus || 'its derived status'}.`
    case 'SETTINGS_UPDATED':
      return `Updated ${formatSettingsSections(metadata.changedSections)}.`
    case 'PRODUCTION_SPEC_UPDATED': {
      const labelSuffix = metadata.label ? ` (${metadata.label})` : ''
      return `${sensor} production spec${labelSuffix} was updated.`
    }
    case 'PRODUCTION_SPEC_BATCH_UPDATED': {
      const matched = metadata.matchedCount ?? 0
      const updated = metadata.updatedCount ?? 0
      const recordWord = matched === 1 ? 'record' : 'records'
      return `Updated ${updated} of ${matched} matched production ${recordWord} for ${sensor}.`
    }
    case 'REPORT_EXPORTED': {
      const category = cleanCode(metadata.reportCategory, 'production').toLowerCase()
      const formatLabel = metadata.format ? String(metadata.format).toUpperCase() : 'FILE'
      return `Exported ${category} report (${formatLabel}).`
    }
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
    { label: 'What happened', value: getReadableDetails(log), emphasis: 'primary', fullWidth: true },
    { label: 'Who did it', value: getReadableActor(log) },
    { label: 'Time', value: formatDateTime(log.createdAt, { second: '2-digit' }) },
    { label: 'Affected item', value: getReadableTarget(log) },
    { label: 'Source', value: getReadableSource(log) },
    ...(log.action === 'SENSOR_MANUAL_RECOVERY_OVERRIDE' && log.metadata?.reason
      ? [{ label: 'Override reason', value: log.metadata.reason, fullWidth: true }]
      : []),
  ]
}

function isSensorActivity(log) {
  return log.action?.startsWith('WATCHDOG_')
    || log.action?.startsWith('CONNECTIVITY_')
    || log.action?.startsWith('IOT_')
    || log.metadata?.deviceId
    || log.metadata?.source === 'esp32_event'
}
