const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const { exportRateLimiter } = require('../../middleware/rateLimiters')
const reportsController = require('./reports.controller')
const { exportReportSchema, reportSummarySchema } = require('./reports.model')

const router = express.Router()

router.use(authenticate)
router.use(authorizeRole(['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Managing Director']))

router.get('/summary', validateRequest(reportSummarySchema), asyncHandler(reportsController.getSummary))

// Export authorization is narrower than view access per the documented control:
// Admin, Managing Director, and Operation Manager only.
router.post(
  '/export',
  authorizeRole(['Admin', 'Managing Director', 'Operation Manager']),
  exportRateLimiter,
  validateRequest(exportReportSchema),
  asyncHandler(reportsController.exportReport),
)

module.exports = router
