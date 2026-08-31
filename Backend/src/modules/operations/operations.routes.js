const express = require('express')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const operationsController = require('./operations.controller')
const { watchdogDiagnosticsSchema } = require('./operations.model')

const router = express.Router()

router.get('/sse', authenticate, authorizeRole('Admin'), operationsController.getSseStatus)
router.get(
  '/watchdog',
  authenticate,
  authorizeRole('Admin'),
  validateRequest(watchdogDiagnosticsSchema),
  operationsController.getWatchdogStatus,
)

module.exports = router
