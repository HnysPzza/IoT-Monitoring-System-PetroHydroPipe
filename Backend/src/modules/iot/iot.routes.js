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
const heartbeatController = require('./heartbeat.controller')
const authenticateIotDevice = require('./iotDevice.middleware')
const { liveFeedRequestSchema, sensorEventSchema } = require('./iot.model')
const { heartbeatSchema } = require('./heartbeat.model')

const router = express.Router()

router.post(
  '/heartbeats',
  iotIngressRateLimiter,
  validateRequest(heartbeatSchema),
  asyncHandler(authenticateIotDevice),
  iotVerifiedDeviceRateLimiter,
  asyncHandler(heartbeatController.createHeartbeat),
)
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
  validateRequest(liveFeedRequestSchema),
  asyncHandler(iotController.getLiveFeed),
)

module.exports = router
