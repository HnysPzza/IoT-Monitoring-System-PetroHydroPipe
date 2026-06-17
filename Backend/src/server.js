const app = require('./app')
const env = require('./config/env')
const logger = require('./utils/logger')

const PORT = env.PORT

// server.js only starts listening; app.js contains the Express configuration.
app.listen(PORT, () => {
  logger.info(`API server running on http://localhost:${PORT}`)
})
