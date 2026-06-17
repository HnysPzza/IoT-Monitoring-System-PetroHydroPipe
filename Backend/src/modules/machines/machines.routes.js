const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const machinesController = require('./machines.controller')
const { machineIdSchema, machineStatusSchema, sensorStatusSchema } = require('./machines.model')

const router = express.Router()

// Machine setup is limited to Admin and Engineering Supervisor before IoT ingestion.
router.use(authenticate)
router.use(authorizeRole(['Admin', 'Engineering Supervisor']))

router.get('/', asyncHandler(machinesController.listMachines))
router.get('/:id/sensors', validateRequest(machineIdSchema), asyncHandler(machinesController.listSensorsByMachine))
router.patch('/:id/status', validateRequest(machineStatusSchema), asyncHandler(machinesController.updateMachineStatus))
router.patch('/sensors/:id/status', validateRequest(sensorStatusSchema), asyncHandler(machinesController.updateSensorStatus))

module.exports = router
