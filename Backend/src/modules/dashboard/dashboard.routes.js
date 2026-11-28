const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const { heavyReadRateLimiter } = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const dashboardController = require('./dashboard.controller')
const { downtimeImpactQuerySchema, overviewQuerySchema } = require('./dashboard.model')

const router = express.Router()

router.use(authenticate)
router.use(authorizeRole(['Admin', 'Operation Manager', 'Quality Control', 'Engineering Supervisor', 'Production Supervisor']))

router.get('/downtime-impact', heavyReadRateLimiter, validateRequest(downtimeImpactQuerySchema), asyncHandler(dashboardController.getDowntimeImpact))
router.get('/overview', heavyReadRateLimiter, validateRequest(overviewQuerySchema), asyncHandler(dashboardController.getOverview))

module.exports = router
