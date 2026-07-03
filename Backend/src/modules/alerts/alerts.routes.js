const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const alertsController = require('./alerts.controller')
const { alertIdSchema } = require('./alerts.model')

const router = express.Router()
const dashboardRoles = ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor']

router.use(authenticate)
router.use(authorizeRole(dashboardRoles))

router.get('/', asyncHandler(alertsController.listAlerts))
router.get('/stream', asyncHandler(alertsController.streamAlerts))
router.patch('/:id/acknowledge', validateRequest(alertIdSchema), asyncHandler(alertsController.acknowledgeAlert))

module.exports = router
