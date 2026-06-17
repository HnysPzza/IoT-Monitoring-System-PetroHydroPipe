const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const auditController = require('./audit.controller')
const { listAuditLogsSchema } = require('./audit.model')

const router = express.Router()

router.use(authenticate)
router.use(authorizeRole('Admin'))

router.get('/', validateRequest(listAuditLogsSchema), asyncHandler(auditController.listAuditLogs))

module.exports = router
