const { connectionRegistry } = require('../shared/sse/connectionRegistry')
const { incrementSseMetric } = require('../shared/sse/metrics')
const { ipKeyGenerator } = require('express-rate-limit')
const { randomUUID } = require('node:crypto')
const logger = require('../utils/logger')

function admitSseConnection(req, res, next) {
  const expiresAtSeconds = req.tokenPayload?.exp
  const expiresAtMs = expiresAtSeconds * 1000
  const expiresInMs = expiresAtMs - Date.now()
  const userId = req.user?.id || req.user?.sub

  if (
    !Number.isSafeInteger(expiresAtSeconds)
    || !Number.isSafeInteger(expiresAtMs)
    || expiresInMs <= 0
    || expiresInMs > 2_147_483_647
    || !userId
  ) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid or expired token.',
      },
    })
  }

  const admission = connectionRegistry.acquire({
    userId,
    ip: ipKeyGenerator(req.ip || 'unknown'),
  })

  if (!admission.release) {
    incrementSseMetric('connectionLimited')
    logger.warn('SSE connection limited.', {
      activeConnections: admission.counts,
      limit: admission.limit,
      maximumConnections: admission.limits,
      stream: `${req.baseUrl}${req.path}`,
    })
    res.set('Retry-After', '5')
    return res.status(429).json({
      error: {
        code: 'SSE_CONNECTION_LIMITED',
        message: 'Too many active event streams.',
      },
    })
  }

  req.sseConnectionId = randomUUID()
  req.sseConnectionRelease = admission.release

  let streamSetupStarted = false
  const removePreStreamListeners = () => {
    req.off('aborted', releaseBeforeStreamSetup)
    res.off('close', releaseBeforeStreamSetup)
    res.off('error', releaseBeforeStreamSetup)
  }
  const releaseBeforeStreamSetup = () => {
    if (streamSetupStarted) return
    streamSetupStarted = true
    removePreStreamListeners()
    req.sseConnectionRelease?.()
    req.sseConnectionRelease = null
    req.sseConnectionHandoff = null
  }

  req.sseConnectionHandoff = () => {
    if (streamSetupStarted) return
    streamSetupStarted = true
    removePreStreamListeners()
    req.sseConnectionHandoff = null
  }

  req.once('aborted', releaseBeforeStreamSetup)
  res.once('close', releaseBeforeStreamSetup)
  res.once('error', releaseBeforeStreamSetup)

  if (req.aborted || res.destroyed || res.writableEnded) {
    releaseBeforeStreamSetup()
    return undefined
  }

  return next()
}

module.exports = admitSseConnection
