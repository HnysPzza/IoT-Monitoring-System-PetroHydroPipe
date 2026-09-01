const app = require('./app')
const env = require('./config/env')
const logger = require('./utils/logger')
const { closeAllSseStreams } = require('./shared/sse/openSseStream')
const watchdog = require('./modules/watchdog')
const { createShutdownHandler, handleServerError } = require('./serverLifecycle')

const PORT = env.PORT

// server.js only starts listening; app.js contains the Express configuration.
const server = app.listen(PORT, () => {
  logger.info(`API server running on http://localhost:${PORT}`)
  watchdog.start()
})

server.once('error', (error) => handleServerError(error))

const shutdown = createShutdownHandler({
  server,
  stopWatchdog: watchdog.stop,
  closeStreams: closeAllSseStreams,
  timeoutMs: env.SERVER_SHUTDOWN_TIMEOUT_MS,
})

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
