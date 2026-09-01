const env = require('../config/env')
const { runWithRequestSignal } = require('../shared/requestContext')

function createRequestError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function requestDeadline(req, res, next) {
  const controller = new AbortController()

  function cleanup() {
    clearTimeout(timeoutId)
    req.off('aborted', handleClientDisconnect)
    res.off('close', handleResponseClose)
    res.off('finish', cleanup)
  }

  function handleClientDisconnect() {
    if (controller.signal.aborted) return
    controller.abort(createRequestError(499, 'CLIENT_DISCONNECTED', 'Client disconnected.'))
  }

  function handleResponseClose() {
    if (!res.writableEnded) handleClientDisconnect()
    cleanup()
  }

  const timeoutId = setTimeout(() => {
    if (res.headersSent || res.writableEnded) {
      cleanup()
      return
    }

    controller.abort(createRequestError(
      504,
      'UPSTREAM_TIMEOUT',
      'The data service did not respond in time. Please try again.',
    ))
  }, env.API_REQUEST_TIMEOUT_MS)
  timeoutId.unref?.()

  req.requestSignal = controller.signal
  req.once('aborted', handleClientDisconnect)
  res.once('close', handleResponseClose)
  res.once('finish', cleanup)

  runWithRequestSignal(controller.signal, next)
}

module.exports = requestDeadline
