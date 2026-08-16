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
    const limits = {
      total: maxTotal,
      user: maxPerUser,
      ip: maxPerIp,
    }
    const counts = {
      total,
      user: userCount,
      ip: ipCount,
    }
    const limit = total >= maxTotal
      ? 'total'
      : userCount >= maxPerUser
        ? 'user'
        : ipCount >= maxPerIp
          ? 'ip'
          : null

    if (limit) {
      return {
        counts,
        limit,
        limits,
        release: null,
      }
    }

    total += 1
    userCounts.set(userId, userCount + 1)
    ipCounts.set(ip, ipCount + 1)
    let released = false

    const release = () => {
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

    return {
      counts,
      limit: null,
      limits,
      release,
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
