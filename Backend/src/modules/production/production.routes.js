const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const productionController = require('./production.controller')
const { listProductionLogsSchema } = require('./production.model')
const { DASHBOARD_STREAM_ROLES } = require('../../shared/sse/streamPolicies')

const router = express.Router()

const PRODUCTION_VIEW_ROLES = DASHBOARD_STREAM_ROLES

router.use(authenticate)

router.get(
  '/',
  authorizeRole(PRODUCTION_VIEW_ROLES),
  validateRequest(listProductionLogsSchema),
  asyncHandler(productionController.listProductionLogs),
)

module.exports = router
