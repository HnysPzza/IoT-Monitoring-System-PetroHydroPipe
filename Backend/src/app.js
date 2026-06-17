const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const morgan = require('morgan')
const env = require('./config/env')
const errorHandler = require('./middleware/errorHandler')
const routes = require('./routes')

const app = express()
const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
const isDevelopment = env.NODE_ENV === 'development'

function corsOrigin(origin, callback) {
  if (!origin || corsOrigins.includes(origin)) {
    return callback(null, true)
  }

  return callback(null, false)
}

// Global middleware runs before every API route.
app.use(helmet())
app.use(cors({ origin: corsOrigin }))
app.use(express.json({ limit: '100kb' }))

if (isDevelopment) {
  app.use(morgan('dev'))
}

// Health stays public so frontend/dev tools can verify the backend is running.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'iot-monitoring-backend',
  })
})

// Feature route prefixes. Some modules are placeholders until later phases.
app.use('/api', routes)

// Unknown API paths return a consistent JSON error.
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
  })
})

// Central error handler must be mounted last.
app.use(errorHandler)

module.exports = app
