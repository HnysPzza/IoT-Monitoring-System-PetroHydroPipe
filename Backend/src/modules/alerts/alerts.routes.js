const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const admitSseConnection = require('../../middleware/admitSseConnection')
const validateRequest = require('../../middleware/validateRequest')
const alertsController = require('./alerts.controller')
const { alertIdSchema } = require('./alerts.model')
const { DASHBOARD_STREAM_ROLES } = require('../../shared/sse/streamPolicies')

const router = express.Router()
const alertActionRoles = DASHBOARD_STREAM_ROLES.filter((role) => role !== 'Managing Director')
router.use(authenticate)

router.get('/', authorizeRole(DASHBOARD_STREAM_ROLES), asyncHandler(alertsController.listAlerts))
router.get('/stream', authorizeRole(DASHBOARD_STREAM_ROLES), admitSseConnection, asyncHandler(alertsController.streamAlerts))
router.patch('/:id/acknowledge', authorizeRole(alertActionRoles), validateRequest(alertIdSchema), asyncHandler(alertsController.acknowledgeAlert))

module.exports = router
