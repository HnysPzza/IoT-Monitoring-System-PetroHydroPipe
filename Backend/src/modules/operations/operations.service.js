const { connectionRegistry } = require('../../shared/sse/connectionRegistry')
const { getSseMetrics } = require('../../shared/sse/metrics')
const watchdog = require('../watchdog')

function getSseStatus() {
  const active = connectionRegistry.getCounts()

  return {
    activeConnections: active.total,
    activeIps: active.ips.size,
    activeUsers: active.users.size,
    counters: getSseMetrics(),
  }
}

function getWatchdogStatus() {
  return watchdog.getWatchdogStatus()
}

module.exports = {
  getSseStatus,
  getWatchdogStatus,
}
