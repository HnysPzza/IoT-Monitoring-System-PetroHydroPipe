const logger = require('../utils/logger')

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err)
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } })
  }

  const abortReason = req.requestSignal?.reason

  if (abortReason?.code === 'CLIENT_DISCONNECTED' && (req.aborted || res.destroyed)) {
    return undefined
  }

  const effectiveError = abortReason?.code === 'UPSTREAM_TIMEOUT' ? abortReason : err
  const status = effectiveError.status || effectiveError.statusCode || 500
  const isServerError = status >= 500
  const isSafeTimeout = effectiveError.code === 'UPSTREAM_TIMEOUT'

  if (isSafeTimeout) {
    logger.warn('Upstream request timed out.', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
    })
  } else if (isServerError) {
    // Log server errors internally, but do not expose details to clients.
    logger.error(effectiveError.stack || effectiveError.message || 'Unexpected server error.')
  }

  return res.status(status).json({
    error: {
      code: effectiveError.code || (isServerError ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
      message: isServerError && !isSafeTimeout ? 'Unexpected server error.' : effectiveError.message,
    },
  })
}

module.exports = errorHandler
