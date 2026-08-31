const env = require('../../config/env')
const { createWatchdogMetrics } = require('./watchdog.metrics')
const { createWatchdogRunner } = require('./watchdog.runner')
const { createWatchdogService } = require('./watchdog.service')

const metrics = createWatchdogMetrics()
const service = createWatchdogService()
const runner = createWatchdogRunner({
  service,
  metrics,
  mode: env.WATCHDOG_MODE,
  intervalMs: env.WATCHDOG_TICK_INTERVAL_MS,
  timeoutMs: env.WATCHDOG_EVALUATION_TIMEOUT_MS,
  staleAfterSeconds: Math.floor(env.IOT_HEARTBEAT_STALE_AFTER_MS / 1000),
})

function getWatchdogStatus() {
  const snapshot = metrics.snapshot()
  const states = snapshot.cycles === 0 ? {} : snapshot.states
  return {
    ...runner.status(),
    lastOutcome: snapshot.lastOutcome,
    lastStartedAt: snapshot.lastStartedAt,
    lastCompletedAt: snapshot.lastCompletedAt,
    lastSuccessAt: snapshot.lastSuccessAt,
    lastErrorCode: snapshot.lastErrorCode,
    counters: {
      cycles: snapshot.cycles,
      cycleSuccesses: snapshot.cycleSuccesses,
      cyclePartialFailures: snapshot.cyclePartialFailures,
      cycleFailures: snapshot.cycleFailures,
      cycleCancellations: snapshot.cycleCancellations,
      sensorEvaluations: snapshot.sensorEvaluations,
      sensorFailures: snapshot.sensorFailures,
      transitions: snapshot.transitions,
    },
    states,
  }
}

module.exports = {
  getWatchdogStatus,
  start: runner.start,
  stop: runner.stop,
}
