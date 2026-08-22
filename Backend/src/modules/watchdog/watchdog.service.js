const logger = require('../../utils/logger')
const repository = require('./watchdog.repository')
const { publishTransitionDescriptors } = require('../operations/transitionPublisher')

const CONNECTIVITY_STATES = new Set(['unknown', 'online', 'offline'])
const DETECTION_STATES = new Set(['disabled', 'suspended', 'healthy', 'grace', 'downtime', 'recovering'])
const ALL_STATES = new Set([...CONNECTIVITY_STATES, ...DETECTION_STATES])
const SENSOR_CODES = new Set(['S-01', 'S-02', 'S-03', 'S-04', 'S-05'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createWatchdogServiceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return

  if (signal.reason instanceof Error && typeof signal.reason.code === 'string') {
    throw signal.reason
  }

  const error = new Error('Watchdog cycle was aborted.')
  error.code = 'WATCHDOG_CYCLE_ABORTED'
  throw error
}

function validateCycleResult(result) {
  if (!result || !Array.isArray(result.evaluations) || !result.states || Array.isArray(result.states)) {
    throw createWatchdogServiceError('WATCHDOG_CYCLE_RESULT_INVALID', 'Watchdog cycle returned invalid data.')
  }

  const seenSensorIds = new Set()
  const seenSensorCodes = new Set()
  for (const evaluation of result.evaluations) {
    const commonValid = UUID_PATTERN.test(evaluation?.evaluated_sensor_id)
      && SENSOR_CODES.has(evaluation.sensor_code)
      && typeof evaluation.machine_code === 'string'
      && evaluation.machine_code.length > 0
      && typeof evaluation.succeeded === 'boolean'
      && Array.isArray(evaluation.transition_descriptors)
      && !seenSensorIds.has(evaluation.evaluated_sensor_id)
      && !seenSensorCodes.has(evaluation.sensor_code)
    const successValid = evaluation?.succeeded === true
      && CONNECTIVITY_STATES.has(evaluation.connectivity_state)
      && DETECTION_STATES.has(evaluation.detection_state)
      && evaluation.error_code === null
    const failureValid = evaluation?.succeeded === false
      && evaluation.connectivity_state === null
      && evaluation.detection_state === null
      && evaluation.transition_descriptors.length === 0
      && evaluation.error_code === 'WATCHDOG_EVALUATION_FAILED'

    if (!commonValid || (!successValid && !failureValid)) {
      throw createWatchdogServiceError('WATCHDOG_CYCLE_RESULT_INVALID', 'Watchdog cycle returned invalid data.')
    }
    seenSensorIds.add(evaluation.evaluated_sensor_id)
    seenSensorCodes.add(evaluation.sensor_code)
  }

  const stateEntries = Object.entries(result.states)
  if (stateEntries.some(([state, count]) => !ALL_STATES.has(state) || !Number.isInteger(count) || count < 0)) {
    throw createWatchdogServiceError('WATCHDOG_CYCLE_RESULT_INVALID', 'Watchdog cycle returned invalid data.')
  }
  const connectivityCount = stateEntries
    .filter(([state]) => CONNECTIVITY_STATES.has(state))
    .reduce((total, [, count]) => total + count, 0)
  const detectionCount = stateEntries
    .filter(([state]) => DETECTION_STATES.has(state))
    .reduce((total, [, count]) => total + count, 0)
  if (connectivityCount !== result.evaluations.length || detectionCount !== result.evaluations.length) {
    throw createWatchdogServiceError('WATCHDOG_CYCLE_RESULT_INVALID', 'Watchdog cycle returned invalid data.')
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
      const result = validateCycleResult(await watchdogRepository.evaluateCycle({
        evaluatedAt,
        mode,
        staleAfterSeconds,
        signal,
      }))
      throwIfAborted(signal)

      let successfulSensors = 0
      let failedSensors = 0
      for (const evaluation of result.evaluations) {
        if (!evaluation.succeeded) {
          failedSensors += 1
          metrics.sensorEvaluated({ failed: true })
          serviceLogger.error('Watchdog sensor evaluation failed.', {
            sensorCode: evaluation.sensor_code,
            machineCode: evaluation.machine_code,
            errorCode: evaluation.error_code,
          })
          continue
        }

        successfulSensors += 1
        const published = publisher(evaluation.transition_descriptors)
        metrics.sensorEvaluated({ transitions: evaluation.transition_descriptors.length })
        if (published < evaluation.transition_descriptors.length) {
          serviceLogger.warn('Watchdog transition publication was incomplete.', {
            sensorCode: evaluation.sensor_code,
            machineCode: evaluation.machine_code,
          })
        }
      }

      metrics.setStates(result.states)
      if (result.evaluations.length === 0) {
        throw createWatchdogServiceError('WATCHDOG_NO_SENSORS_CONFIGURED', 'No watchdog sensors are configured.')
      }
      if (successfulSensors === 0) {
        throw createWatchdogServiceError('WATCHDOG_ALL_SENSOR_EVALUATIONS_FAILED', 'All watchdog sensor evaluations failed.')
      }

      return {
        outcome: failedSensors > 0 ? 'partial' : 'success',
        sensorCount: result.evaluations.length,
        successfulSensors,
        failedSensors,
      }
    },
  }
}

module.exports = {
  createWatchdogService,
  validateCycleResult,
}
