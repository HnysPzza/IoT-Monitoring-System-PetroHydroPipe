const express = require('express')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const asyncHandler = require('../../utils/asyncHandler')
const settingsController = require('./settings.controller')
const { patchSettingsSchema, settingsParamsSchema } = require('./settings.model')

const router = express.Router({ mergeParams: true })
const dashboardRoles = [
  'Admin',
  'Operation Manager',
  'Asst. Operation Manager',
  'Engineering Supervisor',
  'Production Supervisor',
]

router.use(authenticate)
router.get(
  '/',
  authorizeRole(dashboardRoles),
  validateRequest(settingsParamsSchema),
  asyncHandler(settingsController.getMachineSettings),
)
router.patch(
  '/',
  authorizeRole('Admin'),
  validateRequest(patchSettingsSchema),
  asyncHandler(settingsController.updateMachineSettings),
)

module.exports = router
