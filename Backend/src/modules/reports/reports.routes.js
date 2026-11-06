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
router.use(authorizeRole(['Admin', 'Operation Manager', 'Quality Control']))

router.get('/summary', validateRequest(reportSummarySchema), asyncHandler(reportsController.getSummary))

// Export authorization is granted to Admin, Operation Manager, and Quality Control.
router.post(
  '/export',
  authorizeRole(['Admin', 'Operation Manager', 'Quality Control']),
  exportRateLimiter,
  validateRequest(exportReportSchema),
  asyncHandler(reportsController.exportReport),
)

module.exports = router
