const express = require('express')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const { userWriteRateLimiter } = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const asyncHandler = require('../../utils/asyncHandler')
const settingsController = require('./settings.controller')
const { patchSettingsSchema, settingsParamsSchema } = require('./settings.model')

const router = express.Router({ mergeParams: true })
const dashboardRoles = [
  'Admin',
  'Operation Manager',
  'Quality Control',
  'Engineering Supervisor',
  'Production Supervisor',
]

const settingsEditRoles = ['Admin', 'Engineering Supervisor']

router.use(authenticate)
router.get(
  '/',
  authorizeRole(dashboardRoles),
  validateRequest(settingsParamsSchema),
  asyncHandler(settingsController.getMachineSettings),
)
router.patch(
  '/',
  authorizeRole(settingsEditRoles),
  userWriteRateLimiter,
  validateRequest(patchSettingsSchema),
  asyncHandler(settingsController.updateMachineSettings),
)

module.exports = router
