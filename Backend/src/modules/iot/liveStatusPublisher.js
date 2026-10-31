// ponytail: dedupe key lives in process memory, which is correct for one backend instance; move to a shared bus if the backend scales out.
const DEFAULT_COALESCE_MS = 150

function toStatusKey(live) {
  return JSON.stringify([
    live.machine?.status ?? null,
    (live.sensors || []).map((sensor) => [
      sensor.sensorCode,
      sensor.status,
      sensor.physicalStatus,
      sensor.signal,
      sensor.monitoring?.connectivityState ?? null,
      sensor.monitoring?.detectionState ?? null,
    ]),
  ])
}

function createLiveStatusPublisher({
  loadLiveFeed,
  publish,
  logger,
  coalesceMs = DEFAULT_COALESCE_MS,
  schedule = setTimeout,
}) {
  let lastPublishedKey = null
  let pendingTimer = null

  async function flush() {
    pendingTimer = null
    try {
      const live = await loadLiveFeed()
      const key = toStatusKey(live)
      if (key === lastPublishedKey) return
      publish(live)
      lastPublishedKey = key
    } catch (error) {
      logger.error('LIVE_STATUS_PUBLISH_FAILED', { code: error?.code || null })
    }
  }

  function requestPublish() {
    if (pendingTimer !== null) return
    pendingTimer = schedule(flush, coalesceMs)
  }

  return { requestPublish }
}

let globalPublisher = null

function initLiveStatusPublisher({ loadLiveFeed, publish, logger, ...options } = {}) {
  globalPublisher = createLiveStatusPublisher({ loadLiveFeed, publish, logger, ...options })
  return globalPublisher
}

function requestLiveStatusPublish() {
  if (!globalPublisher) {
    const alertsService = require('../alerts/alerts.service')
    const { getLiveFeed } = require('./iot.service')
    const logger = require('../../utils/logger')
    globalPublisher = createLiveStatusPublisher({
      loadLiveFeed: getLiveFeed,
      publish: alertsService.publishSensorStatus,
      logger,
    })
  }
  return globalPublisher.requestPublish()
}

module.exports = {
  createLiveStatusPublisher,
  initLiveStatusPublisher,
  requestLiveStatusPublish,
}
