const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const {
  iotIngressRateLimiter,
  iotVerifiedDeviceRateLimiter,
} = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const iotController = require('./iot.controller')
const authenticateIotDevice = require('./iotDevice.middleware')
const { sensorEventSchema } = require('./iot.model')

const router = express.Router()

router.post(
  '/events',
  iotIngressRateLimiter,
  validateRequest(sensorEventSchema),
  asyncHandler(authenticateIotDevice),
  iotVerifiedDeviceRateLimiter,
  asyncHandler(iotController.createSensorEvent),
)
router.get(
  '/live',
  authenticate,
  authorizeRole(['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Production Supervisor']),
  asyncHandler(iotController.getLiveFeed),
)

module.exports = router
