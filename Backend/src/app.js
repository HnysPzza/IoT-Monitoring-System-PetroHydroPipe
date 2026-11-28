const fs = require('node:fs')
const path = require('node:path')
const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const morgan = require('morgan')
const env = require('./config/env')
const errorHandler = require('./middleware/errorHandler')
const requestDeadline = require('./middleware/requestDeadline')
const routes = require('./routes')
const healthRoutes = require('./modules/health/health.routes')

const DEFAULT_FRONTEND_DIST_DIR = path.resolve(__dirname, '..', '..', 'Frontend', 'dist')
const HASHED_ASSET_PATTERN = /-[A-Za-z0-9_-]{8}\.(?:js|css)$/i
const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
const isDevelopment = env.NODE_ENV === 'development'

function corsOrigin(origin, callback) {
  if (!origin || corsOrigins.includes(origin)) {
    return callback(null, true)
  }

  return callback(null, false)
}

function sendNotFound(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
  })
}

function setStaticCacheHeaders(res, filePath) {
  if (path.basename(filePath) === 'index.html') {
    res.setHeader('Cache-Control', 'no-cache')
    return
  }

  if (HASHED_ASSET_PATTERN.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    return
  }

  res.setHeader('Cache-Control', 'public, max-age=3600')
}

function createApp({ frontendDistDir = DEFAULT_FRONTEND_DIST_DIR } = {}) {
  const app = express()
  app.set('trust proxy', env.TRUST_PROXY)

  // Global middleware runs before every route.
  app.use(helmet({
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }))
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
    exposedHeaders: ['Retry-After', 'Content-Disposition'],
  }))
  app.use(express.json({ limit: '100kb' }))

  if (isDevelopment) {
    app.use(morgan('dev'))
  }

  // Health stays public so deployment probes can distinguish liveness from readiness.
  app.use('/api/health', healthRoutes)

  // Feature route prefixes and explicit API 404 isolation before SPA fallback.
  app.use('/api', requestDeadline, routes)
  app.use('/api', sendNotFound)

  // Serve the built SPA directly from Express so browser traffic stays single-hop.
  const indexHtmlPath = path.join(frontendDistDir, 'index.html')
  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(frontendDistDir, {
      dotfiles: 'ignore',
      setHeaders: setStaticCacheHeaders,
    }))

    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || path.extname(req.path)) {
        return next()
      }

      res.setHeader('Cache-Control', 'no-cache')
      return res.sendFile(indexHtmlPath)
    })
  }

  // Unknown paths return a consistent JSON error.
  app.use(sendNotFound)

  // Central error handler must be mounted last.
  app.use(errorHandler)

  return app
}

const app = createApp()
app.createApp = createApp

module.exports = app
