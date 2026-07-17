const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const downtimeController = require('./downtime.controller')
const { listDowntimeSchema, updateDowntimeSchema } = require('./downtime.model')

const router = express.Router()
const downtimeViewRoles = ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor']
const downtimeEditRoles = ['Admin', 'Operation Manager', 'Engineering Supervisor', 'Production Supervisor']

router.use(authenticate)

router.get('/', authorizeRole(downtimeViewRoles), validateRequest(listDowntimeSchema), asyncHandler(downtimeController.listDowntime))
router.get('/stream', authorizeRole(downtimeViewRoles), asyncHandler(downtimeController.streamDowntime))
router.patch('/:id', authorizeRole(downtimeEditRoles), validateRequest(updateDowntimeSchema), asyncHandler(downtimeController.updateDowntime))

module.exports = router
