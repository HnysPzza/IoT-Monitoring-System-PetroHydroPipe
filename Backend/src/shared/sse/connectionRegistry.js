const env = require('../../config/env')

function createConnectionRegistry({
  maxPerUser = env.SSE_MAX_CONNECTIONS_PER_USER,
  maxPerIp = env.SSE_MAX_CONNECTIONS_PER_IP,
  maxTotal = env.SSE_MAX_CONNECTIONS_TOTAL,
} = {}) {
  const userCounts = new Map()
  const ipCounts = new Map()
  let total = 0

  function acquire({ userId, ip }) {
    const userCount = userCounts.get(userId) || 0
    const ipCount = ipCounts.get(ip) || 0

    if (total >= maxTotal || userCount >= maxPerUser || ipCount >= maxPerIp) {
      return null
    }

    total += 1
    userCounts.set(userId, userCount + 1)
    ipCounts.set(ip, ipCount + 1)
    let released = false

    return () => {
      if (released) return
      released = true
      total -= 1

      const nextUserCount = (userCounts.get(userId) || 1) - 1
      const nextIpCount = (ipCounts.get(ip) || 1) - 1

      if (nextUserCount > 0) userCounts.set(userId, nextUserCount)
      else userCounts.delete(userId)

      if (nextIpCount > 0) ipCounts.set(ip, nextIpCount)
      else ipCounts.delete(ip)
    }
  }

  function getCounts() {
    return {
      total,
      users: new Map(userCounts),
      ips: new Map(ipCounts),
    }
  }

  return { acquire, getCounts }
}

const connectionRegistry = createConnectionRegistry()

module.exports = {
  connectionRegistry,
  createConnectionRegistry,
}
