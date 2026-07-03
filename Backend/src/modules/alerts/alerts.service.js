const { EventEmitter } = require('node:events')
const { getSupabaseClient } = require('../../database/client')
const { getSensorLabel } = require('../../shared/sensorIdentity')
const { recordAuditLog } = require('../audit/audit.service')

const alertEvents = new EventEmitter()
alertEvents.setMaxListeners(100)

function createAlertError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getRelatedRecord(record, key) {
  if (Array.isArray(record?.[key])) {
    return record[key][0] || null
  }

  return record?.[key] || null
}

function getRoleName(userRecord) {
  if (!userRecord) return null

  if (Array.isArray(userRecord.roles)) {
    return userRecord.roles[0]?.name || null
  }

  return userRecord.role || userRecord.roles?.name || null
}

function removeRecoveryMetadata(metadata = {}) {
  const {
    recoveryPending,
    recoveredAt,
    recoveryEventId,
    recoveryEventType,
    recoverySignal,
    acknowledgedAfterRecovery,
    ...rest
  } = metadata || {}

  return rest
}

function withRecoveryMetadata(metadata = {}, recovery = {}) {
  return {
    ...(metadata || {}),
    recoveryPending: true,
    recoveredAt: recovery.recordedAt || new Date().toISOString(),
    recoveryEventId: recovery.eventId || null,
    recoveryEventType: recovery.eventType || null,
    recoverySignal: recovery.signal || null,
  }
}

function hasPendingRecovery(alertRecord) {
  return Boolean(alertRecord?.metadata?.recoveryPending)
}

function toAlertResponse(alertRecord, acknowledgedByOverride = null) {
  const machine = getRelatedRecord(alertRecord, 'machines')
  const sensor = getRelatedRecord(alertRecord, 'sensors')
  const acknowledgedBy = acknowledgedByOverride || getRelatedRecord(alertRecord, 'users')

  return {
    id: alertRecord.id,
    severity: alertRecord.severity,
    status: alertRecord.status,
    title: alertRecord.title,
    message: alertRecord.message,
    sourceType: alertRecord.source_type,
    machine: machine
      ? {
        id: machine.id,
        name: machine.name,
      }
      : null,
    sensor: sensor
      ? {
        id: sensor.id,
        sensorCode: sensor.sensor_code,
        label: getSensorLabel(sensor.sensor_code, sensor.label),
      }
      : null,
    metadata: alertRecord.metadata || {},
    createdAt: alertRecord.created_at,
    acknowledgedAt: alertRecord.acknowledged_at,
    acknowledgedBy: acknowledgedBy
      ? {
        id: acknowledgedBy.id,
        name: acknowledgedBy.name,
        username: acknowledgedBy.username,
        role: getRoleName(acknowledgedBy),
      }
      : null,
    resolvedAt: alertRecord.resolved_at,
  }
}

function emitAlertEvent(type, alert) {
  alertEvents.emit('alert', {
    type,
    alert,
  })
}

function subscribeToAlertEvents(listener) {
  alertEvents.on('alert', listener)

  return () => {
    alertEvents.off('alert', listener)
  }
}

async function listAlerts() {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('alerts')
    .select(`
      id,
      source_type,
      source_id,
      severity,
      status,
      title,
      message,
      metadata,
      created_at,
      acknowledged_at,
      resolved_at,
      machines (
        id,
        name
      ),
      sensors (
        id,
        sensor_code,
        label
      ),
      users (
        id,
        name,
        username,
        roles (
          name
        )
      )
    `)
    .in('status', ['Active', 'Acknowledged'])
    .order('created_at', { ascending: false })

  if (error) {
    throw createAlertError(500, 'ALERTS_QUERY_FAILED', 'Unable to load alerts.')
  }

  return (data || []).map((alert) => toAlertResponse(alert))
}

async function findUnresolvedAlert({ sourceType, sourceId }) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('alerts')
    .select(`
      id,
      source_type,
      source_id,
      severity,
      status,
      title,
      message,
      metadata,
      created_at,
      acknowledged_at,
      resolved_at,
      machines (
        id,
        name
      ),
      sensors (
        id,
        sensor_code,
        label
      )
    `)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .in('status', ['Active', 'Acknowledged'])
    .maybeSingle()

  if (error) {
    throw createAlertError(500, 'ALERT_LOOKUP_FAILED', 'Unable to check existing alert.')
  }

  return data
}

async function loadAlertById(alertId) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('alerts')
    .select(`
      id,
      source_type,
      source_id,
      severity,
      status,
      title,
      message,
      metadata,
      created_at,
      acknowledged_at,
      resolved_at,
      machines (
        id,
        name
      ),
      sensors (
        id,
        sensor_code,
        label
      )
    `)
    .eq('id', alertId)
    .maybeSingle()

  if (error) {
    throw createAlertError(500, 'ALERT_QUERY_FAILED', 'Unable to load alert.')
  }

  if (!data) {
    throw createAlertError(404, 'ALERT_NOT_FOUND', 'Alert not found.')
  }

  return data
}

async function createOrUpdateSensorAlert({ sensor, machine, eventRecord, eventType, signal, recordedAt }) {
  const supabase = getSupabaseClient()
  const label = getSensorLabel(sensor.sensor_code, sensor.label)
  const title = `${label} downtime detected`
  const message = `${sensor.sensor_code} ${label} has no pulse.`
  const metadata = {
    deviceId: sensor.esp32_device_id,
    sensorCode: sensor.sensor_code,
    sensorLabel: label,
    machineCode: machine.machine_code,
    machineName: machine.name,
    eventId: eventRecord.id,
    eventType,
    signal,
    recordedAt,
  }
  const existingAlert = await findUnresolvedAlert({
    sourceType: 'sensor',
    sourceId: sensor.id,
  })

  if (existingAlert) {
    const { data, error } = await supabase
      .from('alerts')
      .update({
        severity: 'Critical',
        title,
        message,
        metadata: {
          ...removeRecoveryMetadata(existingAlert.metadata),
          ...metadata,
        },
      })
      .eq('id', existingAlert.id)
      .select(`
        id,
        source_type,
        source_id,
        severity,
        status,
        title,
        message,
        metadata,
        created_at,
        acknowledged_at,
        resolved_at,
        machines (
          id,
          name
        ),
        sensors (
          id,
          sensor_code,
          label
        )
      `)
      .single()

    if (error) {
      throw createAlertError(500, 'ALERT_UPDATE_FAILED', 'Unable to update alert.')
    }

    const alert = toAlertResponse(data)
    emitAlertEvent('alert.updated', alert)
    return alert
  }

  const { data, error } = await supabase
    .from('alerts')
    .insert({
      source_type: 'sensor',
      source_id: sensor.id,
      machine_id: machine.id,
      sensor_id: sensor.id,
      severity: 'Critical',
      status: 'Active',
      title,
      message,
      metadata,
    })
    .select(`
      id,
      source_type,
      source_id,
      severity,
      status,
      title,
      message,
      metadata,
      created_at,
      acknowledged_at,
      resolved_at,
      machines (
        id,
        name
      ),
      sensors (
        id,
        sensor_code,
        label
      )
    `)
    .single()

  if (error) {
    throw createAlertError(500, 'ALERT_CREATE_FAILED', 'Unable to create alert.')
  }

  const alert = toAlertResponse(data)
  await recordAuditLog({
    action: 'ALERT_CREATED',
    entityType: 'sensor',
    entityId: sensor.id,
    metadata: {
      alertId: alert.id,
      title: alert.title,
      sensorCode: sensor.sensor_code,
      machineCode: machine.machine_code,
      eventType,
      signal,
    },
  })
  emitAlertEvent('alert.created', alert)
  return alert
}

async function resolveAlertForSource({ sourceType, sourceId, metadata = {} }) {
  const existingAlert = await findUnresolvedAlert({ sourceType, sourceId })

  if (!existingAlert) {
    return null
  }

  const supabase = getSupabaseClient()
  const recoveryMetadata = withRecoveryMetadata(existingAlert.metadata, metadata)

  if (existingAlert.status === 'Active') {
    const { data, error } = await supabase
      .from('alerts')
      .update({
        metadata: recoveryMetadata,
      })
      .eq('id', existingAlert.id)
      .select(`
        id,
        source_type,
        source_id,
        severity,
        status,
        title,
        message,
        metadata,
        created_at,
        acknowledged_at,
        resolved_at,
        machines (
          id,
          name
        ),
        sensors (
          id,
          sensor_code,
          label
        )
      `)
      .single()

    if (error) {
      throw createAlertError(500, 'ALERT_RECOVERY_MARK_FAILED', 'Unable to mark alert recovery.')
    }

    const alert = toAlertResponse(data)
    emitAlertEvent('alert.updated', alert)
    return alert
  }

  const { data, error } = await supabase
    .from('alerts')
    .update({
      status: 'Resolved',
      resolved_at: new Date().toISOString(),
      metadata: recoveryMetadata,
    })
    .eq('id', existingAlert.id)
    .select(`
      id,
      source_type,
      source_id,
      severity,
      status,
      title,
      message,
      metadata,
      created_at,
      acknowledged_at,
      resolved_at,
      machines (
        id,
        name
      ),
      sensors (
        id,
        sensor_code,
        label
      )
    `)
    .single()

  if (error) {
    throw createAlertError(500, 'ALERT_RESOLVE_FAILED', 'Unable to resolve alert.')
  }

  const alert = toAlertResponse(data)
  await recordAuditLog({
    action: 'ALERT_RESOLVED',
    entityType: sourceType,
    entityId: sourceId,
    metadata: {
      alertId: alert.id,
      title: alert.title,
      ...metadata,
    },
  })
  emitAlertEvent('alert.resolved', alert)
  return alert
}

async function acknowledgeAlert({ alertId, actorUser }) {
  const alertRecord = await loadAlertById(alertId)

  if (alertRecord.status === 'Resolved') {
    throw createAlertError(409, 'ALERT_ALREADY_RESOLVED', 'Resolved alerts cannot be acknowledged.')
  }

  if (alertRecord.status === 'Acknowledged' && !hasPendingRecovery(alertRecord)) {
    const alert = toAlertResponse(alertRecord, actorUser)
    return alert
  }

  const supabase = getSupabaseClient()
  const acknowledgedAt = new Date().toISOString()
  const shouldResolveAfterAcknowledgement = hasPendingRecovery(alertRecord)
  const { data, error } = await supabase
    .from('alerts')
    .update({
      status: shouldResolveAfterAcknowledgement ? 'Resolved' : 'Acknowledged',
      acknowledged_at: acknowledgedAt,
      acknowledged_by: actorUser.id,
      resolved_at: shouldResolveAfterAcknowledgement ? acknowledgedAt : alertRecord.resolved_at,
      metadata: shouldResolveAfterAcknowledgement
        ? {
          ...(alertRecord.metadata || {}),
          acknowledgedAfterRecovery: true,
        }
        : alertRecord.metadata,
    })
    .eq('id', alertId)
    .select(`
      id,
      source_type,
      source_id,
      severity,
      status,
      title,
      message,
      metadata,
      created_at,
      acknowledged_at,
      resolved_at,
      machines (
        id,
        name
      ),
      sensors (
        id,
        sensor_code,
        label
      )
    `)
    .single()

  if (error) {
    throw createAlertError(500, 'ALERT_ACKNOWLEDGE_FAILED', 'Unable to acknowledge alert.')
  }

  const alert = toAlertResponse(data, actorUser)
  await recordAuditLog({
    userId: actorUser.id,
    action: 'ALERT_ACKNOWLEDGED',
    entityType: data.source_type,
    entityId: data.source_id,
    metadata: {
      alertId: alert.id,
      title: alert.title,
      status: alert.status,
    },
  })

  if (shouldResolveAfterAcknowledgement) {
    await recordAuditLog({
      userId: actorUser.id,
      action: 'ALERT_RESOLVED',
      entityType: data.source_type,
      entityId: data.source_id,
      metadata: {
        alertId: alert.id,
        title: alert.title,
        reason: 'acknowledged_after_recovery',
      },
    })
    emitAlertEvent('alert.resolved', alert)
    return alert
  }

  emitAlertEvent('alert.acknowledged', alert)
  return alert
}

module.exports = {
  acknowledgeAlert,
  createOrUpdateSensorAlert,
  listAlerts,
  resolveAlertForSource,
  subscribeToAlertEvents,
}
