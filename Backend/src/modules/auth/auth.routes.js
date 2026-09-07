const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const { loginRateLimiter, refreshRateLimiter } = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const authController = require('./auth.controller')
const { loginSchema } = require('./auth.model')
const { readRefreshCookie } = require('./refreshToken.cookie')
const env = require('../../config/env')
const onboarding = require('./onboarding.service')
const { setupPasswordSchema, changePasswordSchema } = require('./auth.model')
const { rateLimit } = require('express-rate-limit')
const setupLimiter = rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: true, legacyHeaders: false })

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
router.post('/setup-password', setupLimiter, rejectForeignOrigin, validateRequest(setupPasswordSchema), asyncHandler(async (req, res) => {
  await onboarding.setupPassword(req.validated.body)
  res.set('Cache-Control', 'no-store').json({ completed: true })
}))
router.post('/change-password', setupLimiter, rejectForeignOrigin, authenticate, validateRequest(changePasswordSchema), asyncHandler(async (req, res) => {
  await onboarding.changePassword(req.user.sub, req.validated.body)
  res.set('Cache-Control', 'no-store').json({ completed: true })
}))

module.exports = router
