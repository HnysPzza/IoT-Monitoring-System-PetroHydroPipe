const { AsyncLocalStorage } = require('node:async_hooks')

const requestContext = new AsyncLocalStorage()

function runWithRequestSignal(signal, callback, requestId) {
  return requestContext.run({ signal, requestId }, callback)
}

function getRequestSignal() {
  return requestContext.getStore()?.signal
}

function getRequestId() {
  return requestContext.getStore()?.requestId
}

module.exports = {
  getRequestId,
  getRequestSignal,
  runWithRequestSignal,
}
