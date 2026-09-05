const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const { loginRateLimiter, refreshRateLimiter } = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const authController = require('./auth.controller')
const { loginSchema } = require('./auth.model')
const { readRefreshCookie } = require('./refreshToken.cookie')
const env = require('../../config/env')

const router = express.Router()

// The refresh cookie is SameSite=Strict and path-scoped, which already blocks
// the standard CSRF vector. This origin check adds a second layer for the
// cookie-bearing POSTs: a browser-present Origin outside the CORS allowlist
// never reaches the controllers.
function rejectForeignOrigin(req, res, next) {
  const origin = req.get('origin')
  if (!origin) return next()

  const allowed = env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean)
  if (allowed.includes(origin)) return next()

  return res.status(403).json({
    error: {
      code: 'ORIGIN_REJECTED',
      message: 'Request origin is not allowed.',
    },
  })
}

function requireRefreshCookie(req, res, next) {
  if (!readRefreshCookie(req)) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Missing refresh token.',
      },
    })
  }

  next()
}

// Login is rate-limited before validation to slow repeated guessing attempts.
router.post('/login', loginRateLimiter, rejectForeignOrigin, validateRequest(loginSchema), asyncHandler(authController.login))
router.post('/refresh', refreshRateLimiter, rejectForeignOrigin, requireRefreshCookie, asyncHandler(authController.refresh))
router.post('/logout', rejectForeignOrigin, asyncHandler(authController.logout))
router.get('/me', authenticate, asyncHandler(authController.me))

module.exports = router
