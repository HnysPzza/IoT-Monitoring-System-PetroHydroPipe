const { AsyncLocalStorage } = require('node:async_hooks')

const requestContext = new AsyncLocalStorage()

function runWithRequestSignal(signal, callback) {
  return requestContext.run({ signal }, callback)
}

function getRequestSignal() {
  return requestContext.getStore()?.signal
}

module.exports = {
  getRequestSignal,
  runWithRequestSignal,
}
