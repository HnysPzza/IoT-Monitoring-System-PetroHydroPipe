const { connectionRegistry } = require('../shared/sse/connectionRegistry')
const { incrementSseMetric } = require('../shared/sse/metrics')
const { ipKeyGenerator } = require('express-rate-limit')

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

  const release = connectionRegistry.acquire({
    userId,
    ip: ipKeyGenerator(req.ip || 'unknown'),
  })

  if (!release) {
    incrementSseMetric('connectionLimited')
    res.set('Retry-After', '5')
    return res.status(429).json({
      error: {
        code: 'SSE_CONNECTION_LIMITED',
        message: 'Too many active event streams.',
      },
    })
  }

  req.sseConnectionRelease = release
  return next()
}

module.exports = admitSseConnection
