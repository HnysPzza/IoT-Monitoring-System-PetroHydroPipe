const { EventEmitter } = require('node:events')
const { getSupabaseClient } = require('../../database/client')
const logger = require('../../utils/logger')

const alertEvents = new EventEmitter()
alertEvents.setMaxListeners(100)

const ALERT_EVENT_BY_ACTION = Object.freeze({
  acknowledged: 'alert.acknowledged',
  created: 'alert.created',
  resolved: 'alert.resolved',
  updated: 'alert.updated',
})

function createAlertError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function validateRevision(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw createAlertError(500, 'ALERT_REVISION_INVALID', 'Alert state could not be verified.')
  }

  return value
}

function validateAlert(alert) {
  if (!alert || typeof alert !== 'object') {
    throw createAlertError(500, 'ALERT_RESPONSE_INVALID', 'Alert state could not be loaded.')
  }

  validateRevision(alert.revision)
  return alert
}

function publishAlertAction(action, alert) {
  const eventType = Object.hasOwn(ALERT_EVENT_BY_ACTION, action)
    ? ALERT_EVENT_BY_ACTION[action]
    : null

  if (!eventType || !alert) {
    logger.error('ALERT_SSE_TRANSITION_INVALID', {
      alertId: alert?.id || null,
      action: action || null,
    })
    return false
  }

  try {
    validateAlert(alert)
  } catch {
    logger.error('ALERT_SSE_REVISION_INVALID', {
      alertId: alert?.id || null,
      action,
    })
    return false
  }

  const event = { type: eventType, alert }
  let published = true

  alertEvents.rawListeners('alert').forEach((listener) => {
    try {
      listener.call(alertEvents, event)
    } catch {
      published = false
      logger.error('ALERT_SSE_PUBLISH_FAILED', {
        alertId: alert.id || null,
        action,
      })
    }
  })

  return published
}

function subscribeToAlertEvents(listener) {
  alertEvents.on('alert', listener)

  return () => {
    alertEvents.off('alert', listener)
  }
}

async function listAlerts() {
  const { data, error } = await getSupabaseClient()
    .rpc('get_alerts_snapshot')
    .single()

  if (error || !data) {
    throw createAlertError(500, 'ALERTS_QUERY_FAILED', 'Unable to load alerts.')
  }

  const alerts = Array.isArray(data.alerts) ? data.alerts.map(validateAlert) : null

  if (!alerts) {
    throw createAlertError(500, 'ALERT_RESPONSE_INVALID', 'Alert state could not be loaded.')
  }

  return {
    alerts,
    snapshotRevision: validateRevision(data.snapshot_revision),
  }
}

async function acknowledgeAlert({ alertId, actorUser }) {
  const { data, error } = await getSupabaseClient()
    .rpc('acknowledge_alert', {
      p_alert_id: alertId,
      p_actor_user_id: actorUser.id,
    })
    .single()

  if (error || !data) {
    throw createAlertError(500, 'ALERT_ACKNOWLEDGE_FAILED', 'Unable to acknowledge alert.')
  }

  if (data.outcome === 'not_found') {
    throw createAlertError(404, 'ALERT_NOT_FOUND', 'Alert not found.')
  }

  if (data.outcome === 'already_resolved') {
    throw createAlertError(409, 'ALERT_ALREADY_RESOLVED', 'Resolved alerts cannot be acknowledged.')
  }

  if (!['acknowledged', 'already_acknowledged', 'resolved_after_recovery'].includes(data.outcome)) {
    throw createAlertError(500, 'ALERT_ACKNOWLEDGE_INVALID', 'Alert acknowledgement could not be verified.')
  }

  const alert = validateAlert(data.alert_record)

  const expectedAction = data.outcome === 'acknowledged'
    ? 'acknowledged'
    : data.outcome === 'resolved_after_recovery'
      ? 'resolved'
      : null

  if (data.alert_action !== expectedAction) {
    logger.error('ALERT_ACK_TRANSITION_INVALID', {
      alertId: alert.id,
      outcome: data.outcome,
      action: data.alert_action || null,
    })
  } else if (expectedAction) {
    publishAlertAction(expectedAction, alert)
  }

  return alert
}

module.exports = {
  acknowledgeAlert,
  listAlerts,
  publishAlertAction,
  subscribeToAlertEvents,
}
