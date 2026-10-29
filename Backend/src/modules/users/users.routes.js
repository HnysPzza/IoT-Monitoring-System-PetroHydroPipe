const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const { accountWriteLimiter } = require('../../middleware/rateLimiters')
const validateRequest = require('../../middleware/validateRequest')
const usersController = require('./users.controller')
const { archiveUserSchema, createUserSchema, updateUserStatusSchema, listUsersSchema } = require('./users.model')
const { resendSetup, requestPasswordReset } = require('../auth/onboarding.service')

const router = express.Router()

// All user management endpoints require a valid Admin JWT.
router.use(authenticate)
router.use(authorizeRole('Admin'))

router.get('/', validateRequest(listUsersSchema), asyncHandler(usersController.listUsers))
router.get('/roles', asyncHandler(usersController.listRoles))
router.post('/', accountWriteLimiter, validateRequest(createUserSchema), asyncHandler(usersController.createUser))
router.post('/:id/resend-setup', accountWriteLimiter, validateRequest(archiveUserSchema), asyncHandler(async (req, res) => {
  res.json(await resendSetup({ userId: req.validated.params.id, actorUserId: req.user.sub }))
}))
router.post('/:id/password-reset', accountWriteLimiter, validateRequest(archiveUserSchema), asyncHandler(async (req, res) => {
  res.json(await requestPasswordReset({ userId: req.validated.params.id, actorUserId: req.user.sub }))
}))
router.patch('/:id/status', validateRequest(updateUserStatusSchema), asyncHandler(usersController.updateUserStatus))
router.patch('/:id/archive', validateRequest(archiveUserSchema), asyncHandler(usersController.archiveUser))

module.exports = router
