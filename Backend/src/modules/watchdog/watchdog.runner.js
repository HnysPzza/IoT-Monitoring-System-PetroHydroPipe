const logger = require('../../utils/logger')

function createTimeoutError() {
  const error = new Error('Watchdog cycle timed out.')
  error.code = 'WATCHDOG_CYCLE_TIMEOUT'
  return error
}

function createCancellationError() {
  const error = new Error('Watchdog cycle cancelled during shutdown.')
  error.code = 'WATCHDOG_CYCLE_CANCELLED'
  return error
}

function createWatchdogRunner({
  service,
  metrics,
  mode,
  intervalMs,
  timeoutMs,
  staleAfterSeconds,
  clock = () => new Date(),
  runnerLogger = logger,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let running = false
  let inFlight = null
  let nextTimer = null
  let controller = null

  function scheduleNext() {
    if (!running) return
    nextTimer = schedule(() => {
      nextTimer = null
      runCycle()
    }, intervalMs)
    nextTimer?.unref?.()
  }

  async function executeCycle() {
    const startedAt = clock().toISOString()
    metrics.cycleStarted(startedAt)
    controller = new AbortController()
    let timeout = null
    let workPromise = null

    try {
      const timeoutPromise = new Promise((resolve, reject) => {
        timeout = schedule(() => {
          const timeoutError = createTimeoutError()
          reject(timeoutError)
          controller.abort(timeoutError)
        }, timeoutMs)
        timeout?.unref?.()
      })
      workPromise = Promise.resolve().then(() => service.runCycle({
          evaluatedAt: startedAt,
          mode,
          staleAfterSeconds,
          signal: controller.signal,
          metrics,
        }))
      const result = await Promise.race([workPromise, timeoutPromise])
      if (controller.signal.aborted) throw controller.signal.reason
      const outcome = result?.outcome === 'partial' ? 'partial' : 'success'
      metrics.cycleCompleted(clock().toISOString(), {
        outcome,
        errorCode: outcome === 'partial' ? 'WATCHDOG_CYCLE_PARTIAL_FAILURE' : null,
      })
      if (outcome === 'partial') {
        runnerLogger.warn?.('Watchdog cycle partially failed.', {
          errorCode: 'WATCHDOG_CYCLE_PARTIAL_FAILURE',
          failedSensors: result.failedSensors,
          successfulSensors: result.successfulSensors,
        })
      }
    } catch (error) {
      const errorCode = error.code || (controller.signal.aborted ? 'WATCHDOG_CYCLE_ABORTED' : 'WATCHDOG_CYCLE_FAILED')
      if (errorCode === 'WATCHDOG_CYCLE_CANCELLED') {
        metrics.cycleCompleted(clock().toISOString(), { outcome: 'cancelled' })
        runnerLogger.info('Watchdog cycle cancelled during shutdown.', { mode })
      } else {
        metrics.cycleCompleted(clock().toISOString(), { outcome: 'failed', errorCode })
        runnerLogger.error('Watchdog cycle failed.', { errorCode })
      }
    } finally {
      if (timeout) cancel(timeout)
      // Do not schedule another cycle until aborted work actually settles.
      if (workPromise) await workPromise.catch(() => {})
      controller = null
    }
  }

  function runCycle() {
    if (!running || inFlight) return inFlight
    inFlight = executeCycle().finally(() => {
      inFlight = null
      scheduleNext()
    })
    return inFlight
  }

  function start() {
    if (mode === 'disabled') {
      runnerLogger.info('Sensor watchdog is disabled.', { mode })
      return false
    }
    if (running) return false
    running = true
    runnerLogger.info('Sensor watchdog started.', { mode })
    runCycle()
    return true
  }

  async function stop() {
    if (!running && !inFlight) return false
    running = false
    if (nextTimer) cancel(nextTimer)
    nextTimer = null
    controller?.abort(createCancellationError())
    if (inFlight) {
      let stopTimer = null
      await Promise.race([
        inFlight,
        new Promise((resolve) => {
          stopTimer = schedule(resolve, timeoutMs)
        }),
      ])
      if (stopTimer) cancel(stopTimer)
    }
    runnerLogger.info('Sensor watchdog stopped.', { mode })
    return true
  }

  function status() {
    return { mode, running, inFlight: Boolean(inFlight) }
  }

  return { start, stop, status }
}

module.exports = {
  createWatchdogRunner,
}
