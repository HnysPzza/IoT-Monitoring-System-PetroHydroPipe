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
  return { ...runner.status(), ...metrics.snapshot() }
}

module.exports = {
  getWatchdogStatus,
  start: runner.start,
  stop: runner.stop,
}
