const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const { exportRateLimiter, heavyReadRateLimiter } = require('../../middleware/rateLimiters')
const reportsController = require('./reports.controller')
const { exportReportSchema, reportSummarySchema } = require('./reports.model')

const router = express.Router()
const reportRoles = [
  'Admin',
  'Operation Manager',
  'Quality Control',
  'Engineering Supervisor',
]

router.use(authenticate)
router.use(authorizeRole(reportRoles))

router.get('/summary', heavyReadRateLimiter, validateRequest(reportSummarySchema), asyncHandler(reportsController.getSummary))

// Export authorization is granted to Admin, Operation Manager, Quality Control, and Engineering Supervisor.
router.post(
  '/export',
  authorizeRole(reportRoles),
  exportRateLimiter,
  validateRequest(exportReportSchema),
  asyncHandler(reportsController.exportReport),
)

module.exports = router
