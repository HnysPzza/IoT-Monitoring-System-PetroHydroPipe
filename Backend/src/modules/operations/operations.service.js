const { connectionRegistry } = require('../../shared/sse/connectionRegistry')
const { getSseMetrics } = require('../../shared/sse/metrics')

function getSseStatus() {
  const active = connectionRegistry.getCounts()

  return {
    activeConnections: active.total,
    activeIps: active.ips.size,
    activeUsers: active.users.size,
    counters: getSseMetrics(),
  }
}

module.exports = {
  getSseStatus,
}
