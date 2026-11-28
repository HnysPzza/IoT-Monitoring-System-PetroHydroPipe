function createIotError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getMachineRecord(sensorRecord) {
  if (Array.isArray(sensorRecord.machines)) {
    return sensorRecord.machines[0] || null
  }

  return sensorRecord.machines || null
}

function pruneExpiredMapEntries(map, now, maxEntries) {
  if (map.size < maxEntries) return
  for (const [key, entry] of map.entries()) {
    if (entry.expiresAt <= now) map.delete(key)
  }
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value
    if (oldestKey === undefined) break
    map.delete(oldestKey)
  }
}

module.exports = {
  createIotError,
  getMachineRecord,
  pruneExpiredMapEntries,
}
