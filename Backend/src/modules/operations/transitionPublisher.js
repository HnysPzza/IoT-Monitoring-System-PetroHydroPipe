const logger = require('../../utils/logger')
const alertsService = require('../alerts/alerts.service')
const downtimeService = require('../downtime/downtime.service')

const ALERT_ACTIONS = new Set(['created', 'updated', 'acknowledged', 'resolved'])
const DOWNTIME_ACTIONS = new Set(['created', 'resolved'])

function publishAlert(action, record) {
  if (!ALERT_ACTIONS.has(action) || !record?.id) {
    logger.error('ALERT_SSE_TRANSITION_INVALID', { alertId: record?.id || null, action: action || null })
    return false
  }

  try {
    return alertsService.publishAlertAction(action, record)
  } catch {
    logger.error('ALERT_SSE_PUBLISH_FAILED', { alertId: record.id, action })
    return false
  }
}

function publishDowntime(action, descriptor) {
  if (!DOWNTIME_ACTIONS.has(action) || !descriptor?.id) {
    logger.error('DOWNTIME_SSE_TRANSITION_INVALID', { downtimeId: descriptor?.id || null, action: action || null })
    return false
  }

  try {
    return downtimeService.publishDowntimeEvent(`downtime.${action}`, {
      id: descriptor.id,
      status: action === 'created' ? 'Open' : 'Resolved',
      sensorCode: descriptor.sensorCode,
      machineCode: descriptor.machineCode,
    })
  } catch {
    logger.error('DOWNTIME_SSE_PUBLISH_FAILED', { downtimeId: descriptor.id, action })
    return false
  }
}

function publishTransitionDescriptors(descriptors) {
  if (!Array.isArray(descriptors)) {
    logger.error('WATCHDOG_TRANSITION_DESCRIPTORS_INVALID')
    return 0
  }

  return descriptors.reduce((published, descriptor) => {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      logger.error('WATCHDOG_TRANSITION_DESCRIPTOR_INVALID')
      return published
    }

    if (descriptor.kind === 'alert') {
      return published + Number(publishAlert(descriptor.action, descriptor.record))
    }
    if (descriptor.kind === 'downtime') {
      return published + Number(publishDowntime(descriptor.action, descriptor))
    }

    logger.error('WATCHDOG_TRANSITION_KIND_INVALID', { kind: descriptor.kind || null })
    return published
  }, 0)
}

function publishIngestionTransitions({ sensor, machine, processing }) {
  const descriptors = []

  if (processing.downtime_action) {
    descriptors.push({
      kind: 'downtime',
      action: processing.downtime_action,
      id: processing.downtime_id,
      sensorCode: sensor.sensor_code,
      machineCode: machine.machine_code,
    })
  }

  if (Boolean(processing.alert_action) !== Boolean(processing.alert_record)) {
    logger.error('ALERT_SSE_TRANSITION_INVALID', {
      alertId: processing.alert_record?.id || null,
      action: processing.alert_action || null,
    })
  } else if (processing.alert_action) {
    descriptors.push({ kind: 'alert', action: processing.alert_action, record: processing.alert_record })
  }

  return publishTransitionDescriptors(descriptors)
}

module.exports = {
  publishIngestionTransitions,
  publishTransitionDescriptors,
}
