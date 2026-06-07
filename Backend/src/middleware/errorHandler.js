function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err)
  }

  const status = err.status || err.statusCode || 500
  const isServerError = status >= 500

  if (isServerError) {
    console.error(err)
  }

  return res.status(status).json({
    error: {
      code: err.code || (isServerError ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
      message: isServerError ? 'Unexpected server error.' : err.message,
    },
  })
}

module.exports = errorHandler
