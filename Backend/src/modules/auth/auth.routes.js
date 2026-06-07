const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const validateRequest = require('../../middleware/validateRequest')
const authController = require('./auth.controller')
const { loginSchema } = require('./auth.schemas')

const router = express.Router()

router.post('/login', validateRequest(loginSchema), asyncHandler(authController.login))
router.get('/me', authenticate, asyncHandler(authController.me))

module.exports = router
