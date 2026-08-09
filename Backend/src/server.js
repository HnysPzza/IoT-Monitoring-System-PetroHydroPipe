const app = require('./app')
const env = require('./config/env')
const logger = require('./utils/logger')
const { closeAllSseStreams } = require('./shared/sse/openSseStream')

const PORT = env.PORT

// server.js only starts listening; app.js contains the Express configuration.
const server = app.listen(PORT, () => {
  logger.info(`API server running on http://localhost:${PORT}`)
})

let isShuttingDown = false

function shutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info('API server shutdown started.', { signal })
  closeAllSseStreams()
  server.close((error) => {
    if (error) {
      logger.error('API server shutdown failed.', error)
      process.exitCode = 1
    }
  })
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
