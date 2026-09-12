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

function publishIngestionTransitions({ processing }) {
  if (!Array.isArray(processing.transition_descriptors)) {
    logger.error('INGESTION_TRANSITION_DESCRIPTORS_INVALID')
    return 0
  }

  return publishTransitionDescriptors(processing.transition_descriptors)
}

module.exports = {
  publishIngestionTransitions,
  publishTransitionDescriptors,
}
