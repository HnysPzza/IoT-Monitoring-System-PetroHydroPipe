const counters = {
  opened: 0,
  connectionLimited: 0,
  authExpired: 0,
  authRevoked: 0,
  backpressureClosed: 0,
  closed: 0,
}

function incrementSseMetric(name) {
  if (Object.hasOwn(counters, name)) counters[name] += 1
}

function getSseMetrics() {
  return { ...counters }
}

module.exports = {
  getSseMetrics,
  incrementSseMetric,
}
