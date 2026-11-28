const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const logger = require('../../utils/logger')
const { recordAuditLog } = require('../audit/audit.service')
const {
  createIotError,
  getMachineRecord,
  pruneExpiredMapEntries,
} = require('./iot.helpers')

const DUMMY_DEVICE_KEY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
const MAX_DEVICE_AUTH_CACHE_ENTRIES = 64
const MAX_AUTH_TRACKER_ENTRIES = 1024
const verifiedDeviceCache = new Map()
// ponytail: in-process known-ID set; warm from sensors table if multi-node.
const knownSensorDeviceIds = new Set()
const failedAuthBuckets = new Map()
const failedAuthAuditCooldowns = new Map()

async function findSensorByDeviceId(deviceId) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('sensors')
    .select(`
      id,
      sensor_code,
      esp32_device_id,
      device_key_hash,
      machine_id,
      machines (
        id,
        machine_code,
        name
      )
    `)
    .eq('esp32_device_id', deviceId)
    .maybeSingle()

  if (error) {
    throw createIotError(500, 'DEVICE_LOOKUP_FAILED', 'Unable to validate ESP32 device.')
  }

  return data
}

function toVerifiedSensorIdentity(sensorRecord) {
  const machine = getMachineRecord(sensorRecord)
  return {
    id: sensorRecord.id,
    sensor_code: sensorRecord.sensor_code,
    esp32_device_id: sensorRecord.esp32_device_id,
    machine_id: sensorRecord.machine_id,
    machines: machine
      ? {
        id: machine.id,
        machine_code: machine.machine_code,
        name: machine.name,
      }
      : null,
  }
}

function digestDeviceKey(deviceKey) {
  return crypto.createHash('sha256').update(deviceKey).digest()
}

function getCachedSensorEntry(deviceId, now) {
  const cached = verifiedDeviceCache.get(deviceId)
  if (!cached) return null
  if (cached.expiresAt <= now) {
    verifiedDeviceCache.delete(deviceId)
    return null
  }
  return cached
}

function cacheVerifiedSensor(deviceId, keyDigest, sensor, now) {
  const ttlMs = env.IOT_AUTH_CACHE_TTL_MS ?? 30_000
  if (ttlMs <= 0) return
  pruneExpiredMapEntries(verifiedDeviceCache, now, MAX_DEVICE_AUTH_CACHE_ENTRIES)
  verifiedDeviceCache.set(deviceId, {
    keyDigest,
    sensor,
    expiresAt: now + ttlMs,
  })
}

function rememberKnownSensorDeviceId(deviceId) {
  if (!deviceId || knownSensorDeviceIds.has(deviceId)) return
  if (knownSensorDeviceIds.size >= MAX_DEVICE_AUTH_CACHE_ENTRIES) {
    const oldest = knownSensorDeviceIds.values().next().value
    if (oldest !== undefined) knownSensorDeviceIds.delete(oldest)
  }
  knownSensorDeviceIds.add(deviceId)
}

function getFailureBucketKey(deviceId, sourceIp, isKnownDevice = false) {
  if (isKnownDevice && sourceIp) return `ip:${sourceIp}:device:${deviceId || 'missing'}`
  if (isKnownDevice || !sourceIp) return `device:${deviceId || 'missing'}`
  return `ip:${sourceIp}`
}

function assertNotAuthThrottled(bucketKey, now) {
  const limit = env.IOT_AUTH_FAILURE_RATE_LIMIT ?? 10
  const bucket = failedAuthBuckets.get(bucketKey)
  if (!bucket) return
  if (bucket.expiresAt <= now) {
    failedAuthBuckets.delete(bucketKey)
    return
  }
  if (bucket.count >= limit) {
    throw createIotError(429, 'RATE_LIMITED', 'Too many failed ESP32 authentication attempts. Please try again later.')
  }
}

function recordFailedAuthAttempt(bucketKey, now) {
  const windowMs = env.IOT_AUTH_FAILURE_WINDOW_MS ?? 60_000
  const existing = failedAuthBuckets.get(bucketKey)
  if (existing && existing.expiresAt > now) {
    existing.count += 1
    return
  }
  pruneExpiredMapEntries(failedAuthBuckets, now, MAX_AUTH_TRACKER_ENTRIES)
  failedAuthBuckets.set(bucketKey, {
    count: 1,
    expiresAt: now + windowMs,
  })
}

function getAuditCooldownKey({ deviceId, sensorCode, failureBucketKey, reason }) {
  if (sensorCode || reason === 'missing_device_key_hash') {
    return `device:${deviceId}:${reason}`
  }
  return `${failureBucketKey || `device:${deviceId || 'missing'}`}:${reason}`
}

async function recordThrottledAuthFailureAudit({ deviceId, sensorCode, failureBucketKey, reason, now }) {
  const cooldownMs = env.IOT_AUTH_AUDIT_COOLDOWN_MS ?? 60_000
  const cooldownKey = getAuditCooldownKey({ deviceId, sensorCode, failureBucketKey, reason })
  const existing = failedAuthAuditCooldowns.get(cooldownKey)
  if (existing && existing.expiresAt > now) {
    return
  }
  try {
    await recordAuditLog({
      action: 'IOT_DEVICE_AUTH_FAILED',
      entityType: 'iot_device',
      metadata: {
        deviceId: deviceId || null,
        ...(sensorCode ? { sensorCode } : {}),
        reason,
      },
    })
    if (cooldownMs > 0) {
      pruneExpiredMapEntries(failedAuthAuditCooldowns, now, MAX_AUTH_TRACKER_ENTRIES)
      failedAuthAuditCooldowns.set(cooldownKey, { expiresAt: now + cooldownMs })
    }
  } catch (error) {
    logger.error('IOT_AUTH_AUDIT_LOG_FAILED', {
      deviceId: deviceId || null,
      reason,
      error: error.message,
    })
  }
}

async function authenticateDevice({ deviceId, deviceKey, sourceIp }) {
  const now = Date.now()
  const deviceBucketKey = getFailureBucketKey(deviceId, sourceIp, true)
  const ipBucketKey = sourceIp ? getFailureBucketKey(deviceId, sourceIp, false) : null
  const isKnownDevice = Boolean(deviceId && knownSensorDeviceIds.has(deviceId))

  if (!deviceId || !deviceKey) {
    const missingBucketKey = getFailureBucketKey(deviceId, sourceIp, isKnownDevice)
    assertNotAuthThrottled(missingBucketKey, now)
    recordFailedAuthAttempt(missingBucketKey, now)
    await recordThrottledAuthFailureAudit({
      deviceId: deviceId || null,
      failureBucketKey: missingBucketKey,
      reason: !deviceId ? 'missing_device_id' : 'missing_device_key',
      now,
    })
    throw createIotError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
  }

  const keyDigest = digestDeviceKey(deviceKey)
  const cachedEntry = getCachedSensorEntry(deviceId, now)
  if (cachedEntry && crypto.timingSafeEqual(cachedEntry.keyDigest, keyDigest)) {
    rememberKnownSensorDeviceId(deviceId)
    return cachedEntry.sensor
  }

  assertNotAuthThrottled(deviceBucketKey, now)
  if (!isKnownDevice && ipBucketKey) {
    assertNotAuthThrottled(ipBucketKey, now)
  }

  const sensor = await findSensorByDeviceId(deviceId)

  if (!sensor?.device_key_hash) {
    verifiedDeviceCache.delete(deviceId)
    knownSensorDeviceIds.delete(deviceId)
    await bcrypt.compare(deviceKey, DUMMY_DEVICE_KEY_HASH)
    const unknownBucketKey = getFailureBucketKey(deviceId, sourceIp, false)
    recordFailedAuthAttempt(unknownBucketKey, now)
    await recordThrottledAuthFailureAudit({
      deviceId,
      failureBucketKey: unknownBucketKey,
      reason: sensor ? 'missing_device_key_hash' : 'unknown_device',
      now,
    })
    throw createIotError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
  }

  rememberKnownSensorDeviceId(deviceId)
  const keyMatches = await bcrypt.compare(deviceKey, sensor.device_key_hash)

  if (!keyMatches) {
    recordFailedAuthAttempt(deviceBucketKey, now)
    await recordThrottledAuthFailureAudit({
      deviceId,
      sensorCode: sensor.sensor_code,
      failureBucketKey: deviceBucketKey,
      reason: 'invalid_device_key',
      now,
    })
    throw createIotError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
  }

  const verifiedSensor = toVerifiedSensorIdentity(sensor)
  cacheVerifiedSensor(deviceId, keyDigest, verifiedSensor, now)
  return verifiedSensor
}

module.exports = {
  authenticateDevice,
}
