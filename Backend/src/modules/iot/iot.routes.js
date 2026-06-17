const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const { iotEventRateLimiter } = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const iotController = require('./iot.controller')
const { sensorEventSchema } = require('./iot.model')

const router = express.Router()

router.post('/events', iotEventRateLimiter, validateRequest(sensorEventSchema), asyncHandler(iotController.createSensorEvent))
router.get(
  '/live',
  authenticate,
  authorizeRole(['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor']),
  asyncHandler(iotController.getLiveFeed),
)

module.exports = router
