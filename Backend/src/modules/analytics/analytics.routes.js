const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const { analyticsRateLimiter } = require('../../middleware/rateLimiters')
const analyticsController = require('./analytics.controller')
const { analyticsQuerySchema } = require('./analytics.model')

const router = express.Router()

router.use(authenticate)
router.use(authorizeRole([
  'Admin',
  'Operation Manager',
  'Asst. Operation Manager',
  'Engineering Supervisor',
  'Managing Director',
]))
router.use(analyticsRateLimiter)

router.get('/', validateRequest(analyticsQuerySchema), asyncHandler(analyticsController.getAnalytics))

module.exports = router
