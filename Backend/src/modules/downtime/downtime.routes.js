const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const downtimeController = require('./downtime.controller')
const { listDowntimeSchema, updateDowntimeSchema } = require('./downtime.model')

const router = express.Router()

router.use(authenticate)
router.use(authorizeRole(['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor']))

router.get('/', validateRequest(listDowntimeSchema), asyncHandler(downtimeController.listDowntime))
router.patch('/:id', validateRequest(updateDowntimeSchema), asyncHandler(downtimeController.updateDowntime))

module.exports = router
