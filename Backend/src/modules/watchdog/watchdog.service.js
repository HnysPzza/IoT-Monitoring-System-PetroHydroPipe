const logger = require('../../utils/logger')
const repository = require('./watchdog.repository')
const { publishTransitionDescriptors } = require('../operations/transitionPublisher')

const CONNECTIVITY_STATES = new Set(['unknown', 'online', 'offline'])
const DETECTION_STATES = new Set(['disabled', 'suspended', 'healthy', 'grace', 'downtime', 'recovering'])

function throwIfAborted(signal) {
  if (!signal?.aborted) return

  if (signal.reason instanceof Error && typeof signal.reason.code === 'string') {
    throw signal.reason
  }

  const error = new Error('Watchdog cycle was aborted.')
  error.code = 'WATCHDOG_CYCLE_ABORTED'
  throw error
}

function validateEvaluationResult(result, sensorId) {
  const valid = result?.evaluated_sensor_id === sensorId
    && CONNECTIVITY_STATES.has(result.connectivity_state)
    && DETECTION_STATES.has(result.detection_state)
    && Array.isArray(result.transition_descriptors)

  if (!valid) {
    const error = new Error('Watchdog evaluation returned invalid data.')
    error.code = 'WATCHDOG_EVALUATION_RESULT_INVALID'
    throw error
  }

  return result
}

function createWatchdogService({
  watchdogRepository = repository,
  publisher = publishTransitionDescriptors,
  serviceLogger = logger,
} = {}) {
  return {
    async runCycle({ evaluatedAt, mode, staleAfterSeconds, signal, metrics }) {
      throwIfAborted(signal)
      const sensors = await watchdogRepository.listSensors(signal)
      throwIfAborted(signal)

      for (const sensor of sensors) {
        throwIfAborted(signal)
        try {
          const result = validateEvaluationResult(await watchdogRepository.evaluateSensor({
            sensorId: sensor.sensorId,
            evaluatedAt,
            mode,
            staleAfterSeconds,
            signal,
          }), sensor.sensorId)
          const published = publisher(result.transition_descriptors)
          metrics.sensorEvaluated({ transitions: result.transition_descriptors.length })
          if (published < result.transition_descriptors.length) {
            serviceLogger.warn('Watchdog transition publication was incomplete.', {
              sensorCode: sensor.sensorCode,
              machineCode: sensor.machineCode,
            })
          }
        } catch (error) {
          throwIfAborted(signal)
          metrics.sensorEvaluated({ failed: true })
          serviceLogger.error('Watchdog sensor evaluation failed.', {
            sensorCode: sensor.sensorCode,
            machineCode: sensor.machineCode,
            errorCode: error.code || 'WATCHDOG_SENSOR_FAILURE',
          })
        }
      }

      throwIfAborted(signal)
      const states = await watchdogRepository.getStateCounts(signal)
      throwIfAborted(signal)
      metrics.setStates(states)
      return { sensorCount: sensors.length }
    },
  }
}

module.exports = {
  createWatchdogService,
  validateEvaluationResult,
}
