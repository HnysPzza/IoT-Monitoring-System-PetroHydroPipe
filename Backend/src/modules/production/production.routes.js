const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const productionController = require('./production.controller')
const {
  listProductionLogsSchema,
  updateProductionSpecSchema,
  batchUpdateProductionSpecSchema,
} = require('./production.model')
const { DASHBOARD_STREAM_ROLES } = require('../../shared/sse/streamPolicies')

const router = express.Router()

const PRODUCTION_VIEW_ROLES = DASHBOARD_STREAM_ROLES
const PRODUCTION_EDIT_ROLES = Object.freeze(['Admin', 'Operation Manager', 'Production Supervisor', 'Quality Control'])

router.use(authenticate)

router.get(
  '/',
  authorizeRole(PRODUCTION_VIEW_ROLES),
  validateRequest(listProductionLogsSchema),
  asyncHandler(productionController.listProductionLogs),
)

router.patch(
  '/batch',
  authorizeRole(PRODUCTION_EDIT_ROLES),
  validateRequest(batchUpdateProductionSpecSchema),
  asyncHandler(productionController.batchUpdateProductionLogSpecs),
)

router.patch(
  '/:eventId',
  authorizeRole(PRODUCTION_EDIT_ROLES),
  validateRequest(updateProductionSpecSchema),
  asyncHandler(productionController.updateProductionLogSpec),
)

module.exports = router
