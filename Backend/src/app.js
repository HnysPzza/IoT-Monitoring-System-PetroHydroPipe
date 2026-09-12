const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const morgan = require('morgan')
const env = require('./config/env')
const errorHandler = require('./middleware/errorHandler')
const requestDeadline = require('./middleware/requestDeadline')
const routes = require('./routes')
const healthRoutes = require('./modules/health/health.routes')

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
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  exposedHeaders: ['Retry-After'],
}))
app.use(express.json({ limit: '100kb' }))

if (isDevelopment) {
  app.use(morgan('dev'))
}

// Health stays public so deployment probes can distinguish liveness from readiness.
app.use('/api/health', healthRoutes)

// Feature route prefixes. Some modules are placeholders until later phases.
app.use('/api', requestDeadline, routes)

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
