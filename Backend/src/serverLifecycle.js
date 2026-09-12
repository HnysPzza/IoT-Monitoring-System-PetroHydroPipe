const logger = require('./utils/logger')

function handleServerError(error, {
  logger: lifecycleLogger = logger,
  setExitCode = (code) => { process.exitCode = code },
} = {}) {
  lifecycleLogger.error('API server failed.', {
    code: error?.code || 'SERVER_ERROR',
  })
  setExitCode(1)
}

function createShutdownHandler({
  server,
  stopWatchdog,
  closeStreams,
  timeoutMs,
  logger: lifecycleLogger = logger,
  terminate = (code) => process.exit(code),
  setExitCode = (code) => { process.exitCode = code },
} = {}) {
  let shutdownPromise = null

  return function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise

    shutdownPromise = (async () => {
      lifecycleLogger.info('API server shutdown started.', { signal })
      const cleanupErrors = []

      const serverClosed = new Promise((resolve) => {
        try {
          server.close((error) => {
            if (error) cleanupErrors.push(error)
            resolve()
          })
        } catch (error) {
          cleanupErrors.push(error)
          resolve()
        }
      })

      try {
        closeStreams()
      } catch (error) {
        cleanupErrors.push(error)
      }

      try {
        server.closeIdleConnections()
      } catch (error) {
        cleanupErrors.push(error)
      }

      const watchdogStopped = Promise.resolve()
        .then(stopWatchdog)
        .catch((error) => { cleanupErrors.push(error) })

      let timeoutId
      const outcome = await Promise.race([
        Promise.all([serverClosed, watchdogStopped]).then(() => 'completed'),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), timeoutMs)
        }),
      ])
      clearTimeout(timeoutId)

      if (outcome === 'timeout') {
        lifecycleLogger.error('API server shutdown deadline exceeded.', { signal })
        try {
          server.closeAllConnections()
        } catch (error) {
          lifecycleLogger.error('Forced HTTP connection closure failed.', {
            code: error?.code || 'CONNECTION_CLOSE_FAILED',
          })
        } finally {
          terminate(1)
        }
        return 'forced'
      }

      if (cleanupErrors.length > 0) {
        lifecycleLogger.error('API server shutdown failed.', {
          errorCount: cleanupErrors.length,
        })
        setExitCode(1)
        return 'failed'
      }

      lifecycleLogger.info('API server shutdown completed.', { signal })
      return 'graceful'
    })()

    return shutdownPromise
  }
}

module.exports = {
  createShutdownHandler,
  handleServerError,
}
