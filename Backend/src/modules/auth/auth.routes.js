const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const { loginRateLimiter } = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const authController = require('./auth.controller')
const { loginSchema } = require('./auth.model')

const router = express.Router()

// Login is rate-limited before validation to slow repeated guessing attempts.
router.post('/login', loginRateLimiter, validateRequest(loginSchema), asyncHandler(authController.login))
router.get('/me', authenticate, asyncHandler(authController.me))

module.exports = router
