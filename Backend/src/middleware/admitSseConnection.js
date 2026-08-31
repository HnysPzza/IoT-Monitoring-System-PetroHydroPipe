const { connectionRegistry } = require('../shared/sse/connectionRegistry')
const { incrementSseMetric } = require('../shared/sse/metrics')
const { ipKeyGenerator } = require('express-rate-limit')
const { randomUUID } = require('node:crypto')
const logger = require('../utils/logger')

//This function is for token expiration and safe validation
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
  //Resource Quota Limiting
  //limit stream per ip and prevent socket exhaustion
  const admission = connectionRegistry.acquire({
    userId,
    ip: ipKeyGenerator(req.ip || 'unknown'),
  })
  //if quota exceede logs a warning and return 429 with a retry after 5 header
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
  //attaches "listener/tripwire" to each stream - drop if fail
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
  //Edge Race condition
  req.sseConnectionHandoff = () => {
    if (streamSetupStarted) return
    streamSetupStarted = true
    removePreStreamListeners()
    req.sseConnectionHandoff = null
  }
  //check the socket state if flag run immediate health check
  //if not run next() downstream controller takes over
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
