const express = require('express')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const operationsController = require('./operations.controller')

const router = express.Router()

router.get('/sse', authenticate, authorizeRole('Admin'), operationsController.getSseStatus)
router.get('/watchdog', authenticate, authorizeRole('Admin'), operationsController.getWatchdogStatus)

module.exports = router
