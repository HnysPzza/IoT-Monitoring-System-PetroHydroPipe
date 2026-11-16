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
  WATCHDOG_DOWNTIME_CONFIRMED: 'Sensor monitoring confirmed downtime (legacy confirmation)',
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
  MACHINE_STATUS_RECONCILED: 'Machine status reconciled with sensors',
  SENSOR_STATUS_UPDATED: 'Sensor status changed',
  SENSOR_MANUAL_RECOVERY_OVERRIDE: 'Manual sensor recovery override',
  ALERT_CREATED: 'Alert created',
  ALERT_ACKNOWLEDGED: 'Alert acknowledged',
  ALERT_RESOLVED: 'Alert resolved',
  PRODUCTION_SPEC_UPDATED: 'Pipe spec updated',
  PRODUCTION_SPEC_BATCH_UPDATED: 'Pipe specs batch updated',
  SETTINGS_UPDATED: 'Operational settings updated',
  PRODUCTION_CALENDAR_DAY_SET: 'Production calendar day updated',
  PRODUCTION_CALENDAR_RANGE_SET: 'Production calendar range scheduled',
  PRODUCTION_CALENDAR_ENTRY_REMOVED: 'Production calendar entry removed',
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
      'WATCHDOG_DOWNTIME_RESOLVED',
      'CONNECTIVITY_ALERT_CREATED',
      'CONNECTIVITY_ALERT_RESOLVED',
      'IOT_EVENT_RECEIVED',
      'IOT_DEVICE_AUTH_FAILED',
      'IOT_MACHINE_STATUS_UPDATED',
      'DOWNTIME_CREATED',
      'DOWNTIME_AUTO_RESOLVED',
      'DOWNTIME_UPDATED',
      'MACHINE_STATUS_RECONCILED',
      'SENSOR_MANUAL_RECOVERY_OVERRIDE',
    ],
  },
  {
    label: 'Alerts',
    actions: ['ALERT_CREATED', 'ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED'],
  },
  {
    label: 'Production & settings',
    actions: [
      'PRODUCTION_SPEC_UPDATED',
      'PRODUCTION_SPEC_BATCH_UPDATED',
      'SETTINGS_UPDATED',
      'PRODUCTION_CALENDAR_DAY_SET',
      'PRODUCTION_CALENDAR_RANGE_SET',
      'PRODUCTION_CALENDAR_ENTRY_REMOVED',
      'REPORT_EXPORTED',
    ],
  },
]

export const filterableAuditActions = new Set(
  ACTION_GROUP_DEFINITIONS.flatMap((group) => group.actions),
)

const ACTION_ALLOWED_ENTITIES = {
  LOGIN_SUCCESS: new Set(['auth']),
  LOGIN_FAILED: new Set(['auth']),
  REFRESH_TOKEN_REUSED: new Set(['auth']),
  USER_INVITED: new Set(['user']),
  USER_INVITATION_RESENT: new Set(['user']),
  USER_PASSWORD_RESET_REQUESTED: new Set(['user']),
  PASSWORD_SETUP_COMPLETED: new Set(['user']),
  PASSWORD_CHANGED: new Set(['user']),
  PASSWORD_RESET_COMPLETED: new Set(['user']),
  USER_STATUS_UPDATED: new Set(['user']),
  USER_ARCHIVED: new Set(['user']),
  WATCHDOG_DOWNTIME_CREATED: new Set(['downtime']),
  WATCHDOG_DOWNTIME_RESOLVED: new Set(['downtime']),
  CONNECTIVITY_ALERT_CREATED: new Set(['sensor_connectivity']),
  CONNECTIVITY_ALERT_RESOLVED: new Set(['sensor_connectivity']),
  IOT_EVENT_RECEIVED: new Set(['sensor_event']),
  IOT_DEVICE_AUTH_FAILED: new Set(['iot_device']),
  IOT_MACHINE_STATUS_UPDATED: new Set(['machine']),
  DOWNTIME_CREATED: new Set(['downtime']),
  DOWNTIME_AUTO_RESOLVED: new Set(['downtime']),
  DOWNTIME_UPDATED: new Set(['downtime']),
  MACHINE_STATUS_RECONCILED: new Set(['machine']),
  SENSOR_MANUAL_RECOVERY_OVERRIDE: new Set(['sensor']),
  ALERT_CREATED: new Set(['sensor', 'sensor_connectivity', 'machine']),
  ALERT_ACKNOWLEDGED: new Set(['sensor', 'sensor_connectivity', 'machine']),
  ALERT_RESOLVED: new Set(['sensor', 'sensor_connectivity', 'machine']),
  PRODUCTION_SPEC_UPDATED: new Set(['sensor_event']),
  PRODUCTION_SPEC_BATCH_UPDATED: new Set(['sensor_event']),
  SETTINGS_UPDATED: new Set(['machine_settings']),
  PRODUCTION_CALENDAR_DAY_SET: new Set(['production_calendar']),
  PRODUCTION_CALENDAR_RANGE_SET: new Set(['production_calendar']),
  PRODUCTION_CALENDAR_ENTRY_REMOVED: new Set(['production_calendar']),
  REPORT_EXPORTED: new Set(['report']),
}

export function isEntityAllowedForAction(action, entityType) {
  if (!action || action === 'All' || !entityType || entityType === 'All') {
    return true
  }
  const allowed = Object.hasOwn(ACTION_ALLOWED_ENTITIES, action)
    ? ACTION_ALLOWED_ENTITIES[action]
    : null
  return allowed ? allowed.has(entityType) : true
}

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
  production_calendar: 'Production Calendar',
  sensor: 'Sensor',
  sensor_connectivity: 'Sensor connectivity',
  iot_device: 'Sensor device',
  sensor_event: 'Sensor & spec activity',
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
  'USER_PASSWORD_RESET_REQUESTED',
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
  'PASSWORD_RESET_COMPLETED',
])

const STATUS_ACTIONS = new Set([
  'IOT_MACHINE_STATUS_UPDATED',
  'MACHINE_STATUS_RECONCILED',
  'MACHINE_STATUS_UPDATED',
  'SENSOR_STATUS_UPDATED',
  'USER_STATUS_UPDATED',
])

function getStatusTone(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (['downtime', 'fault', 'archived', 'offline', 'disabled', 'rejected'].includes(normalized)) {
    return 'danger'
  }
  if (['inactive', 'idle'].includes(normalized)) {
    return 'warning'
  }
  if (['running', 'active', 'resolved', 'connected'].includes(normalized)) {
    return 'success'
  }
  return null
}

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
  if (STATUS_ACTIONS.has(action)) {
    const metadataTone = getStatusTone(log?.metadata?.newStatus)
    if (metadataTone) {
      return metadataTone
    }
  }
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
  if (!log?.action) {
    return 'System action recorded'
  }
  return Object.hasOwn(actionLabels, log.action) ? actionLabels[log.action] : cleanCode(log.action)
}

export function getReadableEntity(log) {
  return Object.hasOwn(entityLabels, log.entityType) ? entityLabels[log.entityType] : cleanCode(log.entityType)
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
    return 'User session'
  }

  if (log.entityType === 'user') {
    return log.targetUser?.username || log.metadata?.targetUsername || 'User account'
  }

  if (
    log.entityType === 'machine'
    || log.entityType === 'machine_settings'
    || log.entityType === 'production_calendar'
  ) {
    return getMachineName(log)
  }

  if (log.entityType === 'sensor' || log.entityType === 'sensor_connectivity') {
    return getSensorName(log.metadata?.sensorCode) || getReadableEntity(log)
  }

  if (log.entityType === 'iot_device') {
    return getSensorName(log.metadata?.sensorCode) || 'ESP32 gateway'
  }

  if (log.entityType === 'downtime') {
    return getSensorName(log.metadata?.ownerSensorCode || log.metadata?.sensorCode) || getMachineName(log)
  }

  if (log.entityType === 'sensor_event') {
    return getSensorName(log.metadata?.sensorCode) || 'Sensor activity'
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

const calendarDayTypeLabels = {
  holiday: 'Holiday',
  day_off: 'Day off',
  machine_not_scheduled: 'Machine not scheduled',
}

function formatCalendarDayType(dayType) {
  if (!dayType) {
    return 'Day off'
  }
  return Object.hasOwn(calendarDayTypeLabels, dayType)
    ? calendarDayTypeLabels[dayType]
    : cleanCode(dayType)
}

function formatCalendarHolidayList(holidays, fallbackDates) {
  if (Array.isArray(holidays) && holidays.length > 0) {
    return holidays
      .map((holiday) => {
        if (typeof holiday === 'string') return holiday
        if (!holiday || typeof holiday !== 'object') return null
        if (holiday.name && holiday.calendarDate) {
          return `${holiday.name} (${holiday.calendarDate})`
        }
        return holiday.name || holiday.calendarDate || null
      })
      .filter(Boolean)
      .join(', ')
  }
  if (Array.isArray(fallbackDates) && fallbackDates.length > 0) {
    return fallbackDates.filter(Boolean).join(', ')
  }
  return ''
}

function formatCalendarDaySetDetails(metadata) {
  const typeLabel = formatCalendarDayType(metadata.dayType)
  const entryName = metadata.name || typeLabel
  const datePart = metadata.calendarDate ? ` (${metadata.calendarDate})` : ''
  const reasonSuffix = metadata.reason ? ` Reason: ${metadata.reason}.` : ''

  if (metadata.dayType === 'holiday') {
    const statusLabel = metadata.isWorking ? 'Working' : 'Day off'
    return `Set ${entryName}${datePart} to ${statusLabel} (Holiday).${reasonSuffix}`
  }

  if (metadata.dayType === 'machine_not_scheduled') {
    return `Set ${entryName}${datePart} as Machine not scheduled (Day off).${reasonSuffix}`
  }

  return `Set ${entryName}${datePart} as ${typeLabel}.${reasonSuffix}`
}

function formatCalendarRangeSetDetails(metadata) {
  const entryName = metadata.name || 'Shutdown range'
  const typeLabel = formatCalendarDayType(metadata.dayType)
  const spanCount = Number(metadata.dayCount)
  const countPart = Number.isFinite(spanCount) && spanCount > 0
    ? ` (${spanCount} ${spanCount === 1 ? 'day' : 'days'})`
    : ''
  const rangePart = metadata.startDate && metadata.endDate
    ? ` from ${metadata.startDate} to ${metadata.endDate}`
    : ''
  const reasonSuffix = metadata.reason ? ` Reason: ${metadata.reason}.` : ''
  const replacedList = formatCalendarHolidayList(metadata.replacedHolidays, metadata.replacedDates)
  const replacedSuffix = replacedList ? ` Replaced holidays: ${replacedList}.` : ''

  return `Scheduled ${entryName} (${typeLabel})${rangePart}${countPart}.${reasonSuffix}${replacedSuffix}`
}

function formatCalendarEntryRemovedDetails(metadata) {
  const removedDates = Array.isArray(metadata.removedDates) ? metadata.removedDates.filter(Boolean) : []
  const lockedDates = Array.isArray(metadata.lockedDates) ? metadata.lockedDates.filter(Boolean) : []
  const restoredList = formatCalendarHolidayList(metadata.restoredHolidays, metadata.restoredDates)
  const restoredSuffix = restoredList ? ` Restored holidays: ${restoredList}.` : ''
  const isRange = metadata.mode === 'range' || removedDates.length > 1 || Boolean(metadata.groupId)

  if (isRange) {
    const entryName = metadata.name || metadata.previous?.name || 'calendar range'
    const dayType = metadata.dayType || metadata.previous?.dayType
    const typePart = dayType ? ` (${formatCalendarDayType(dayType)})` : ''
    const removedCount = Number(metadata.removedCount) || removedDates.length
    const spanPart = removedDates.length > 1
      ? ` from ${removedDates[0]} to ${removedDates[removedDates.length - 1]} (${removedCount} days)`
      : removedDates.length === 1
        ? ` on ${removedDates[0]}`
        : removedCount > 0
          ? ` (${removedCount} ${removedCount === 1 ? 'day' : 'days'})`
          : ''
    const lockedSuffix = lockedDates.length > 0
      ? ` Kept ${lockedDates.length} elapsed ${lockedDates.length === 1 ? 'date' : 'dates'} locked.`
      : ''

    return `Removed ${entryName}${typePart}${spanPart}.${lockedSuffix}${restoredSuffix}`
  }

  const entryName = metadata.previous?.name || metadata.name || 'calendar entry'
  const dayType = metadata.previous?.dayType || metadata.dayType
  const typePart = dayType ? ` (${formatCalendarDayType(dayType)})` : ''
  const dateText = metadata.calendarDate || removedDates[0] || ''
  const datePart = dateText ? ` on ${dateText}` : ''

  return `Removed ${entryName}${typePart}${datePart}.${restoredSuffix}`
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
    case 'PRODUCTION_CALENDAR_DAY_SET':
      return formatCalendarDaySetDetails(metadata)
    case 'PRODUCTION_CALENDAR_RANGE_SET':
      return formatCalendarRangeSetDetails(metadata)
    case 'PRODUCTION_CALENDAR_ENTRY_REMOVED':
      return formatCalendarEntryRemovedDetails(metadata)
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

function formatPipeSpecSummary(metadata) {
  if (!metadata) {
    return null
  }
  const dimensions = [
    metadata.diameter != null && metadata.diameter !== '' ? `${metadata.diameter} mm OD` : null,
    metadata.thickness != null && metadata.thickness !== '' ? `${metadata.thickness} mm WT` : null,
    metadata.length != null && metadata.length !== '' ? `${metadata.length} mm L` : null,
  ].filter(Boolean)

  const parts = [
    metadata.customer ? `Customer ${metadata.customer}` : null,
    metadata.pipeNumber != null && metadata.pipeNumber !== '' ? `Pipe #${metadata.pipeNumber}` : null,
    dimensions.length > 0 ? dimensions.join(' x ') : null,
    metadata.tonnage != null && metadata.tonnage !== '' ? `${metadata.tonnage} t` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' | ') : null
}

function getExtraDetailItems(log) {
  const metadata = log.metadata || {}
  if (log.action === 'SENSOR_MANUAL_RECOVERY_OVERRIDE' && metadata.reason) {
    return [{ label: 'Override reason', value: metadata.reason, fullWidth: true }]
  }
  if (log.action === 'PRODUCTION_SPEC_UPDATED' || log.action === 'PRODUCTION_SPEC_BATCH_UPDATED') {
    const summary = formatPipeSpecSummary(metadata)
    return summary ? [{ label: 'Pipe details', value: summary, fullWidth: true }] : []
  }
  if (log.action === 'DOWNTIME_UPDATED' && (metadata.cause || metadata.status)) {
    const cause = metadata.cause || 'not set'
    const status = metadata.status ? cleanCode(metadata.status) : 'Reviewed'
    return [{ label: 'Downtime review', value: `${status} — ${cause}`, fullWidth: true }]
  }
  if (log.action === 'SETTINGS_UPDATED' && Array.isArray(metadata.changedSections) && metadata.changedSections.length > 0) {
    return [{ label: 'Updated sections', value: formatSettingsSections(metadata.changedSections), fullWidth: true }]
  }
  if (
    log.action === 'PRODUCTION_CALENDAR_DAY_SET'
    || log.action === 'PRODUCTION_CALENDAR_RANGE_SET'
    || log.action === 'PRODUCTION_CALENDAR_ENTRY_REMOVED'
  ) {
    const items = []
    const reason = metadata.reason || metadata.previous?.reason
    if (reason) {
      items.push({ label: 'Reason', value: reason, fullWidth: true })
    }
    const replacedList = formatCalendarHolidayList(metadata.replacedHolidays, metadata.replacedDates)
    if (replacedList) {
      items.push({ label: 'Replaced holidays', value: replacedList, fullWidth: true })
    }
    const restoredList = formatCalendarHolidayList(metadata.restoredHolidays, metadata.restoredDates)
    if (restoredList) {
      items.push({ label: 'Restored holidays', value: restoredList, fullWidth: true })
    }
    return items
  }
  return []
}

export function getReadableDetailItems(log) {
  return [
    { label: 'What happened', value: getReadableDetails(log), emphasis: 'primary', fullWidth: true },
    { label: 'Who did it', value: getReadableActor(log) },
    { label: 'Time', value: formatDateTime(log.createdAt, { second: '2-digit' }) },
    { label: 'Affected item', value: getReadableTarget(log) },
    { label: 'Source', value: getReadableSource(log) },
    ...getExtraDetailItems(log),
  ]
}

function isSensorActivity(log) {
  return log.action?.startsWith('WATCHDOG_')
    || log.action?.startsWith('CONNECTIVITY_')
    || log.action?.startsWith('IOT_')
    || log.metadata?.deviceId
    || log.metadata?.source === 'esp32_event'
}
