const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const dashboardController = require('./dashboard.controller')
const { downtimeImpactQuerySchema, overviewQuerySchema } = require('./dashboard.model')

const router = express.Router()

router.use(authenticate)
router.use(authorizeRole(['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Managing Director', 'Production Supervisor']))

router.get('/downtime-impact', validateRequest(downtimeImpactQuerySchema), asyncHandler(dashboardController.getDowntimeImpact))
router.get('/overview', validateRequest(overviewQuerySchema), asyncHandler(dashboardController.getOverview))

module.exports = router
