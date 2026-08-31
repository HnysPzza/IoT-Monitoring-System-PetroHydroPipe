const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const reportsController = require('./reports.controller')
const { reportSummarySchema } = require('./reports.model')

const router = express.Router()

router.use(authenticate)
router.use(authorizeRole(['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Managing Director']))

router.get('/summary', validateRequest(reportSummarySchema), asyncHandler(reportsController.getSummary))

module.exports = router
