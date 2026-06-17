const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const usersController = require('./users.controller')
const { archiveUserSchema, createUserSchema, updateUserStatusSchema } = require('./users.model')

const router = express.Router()

// All user management endpoints require a valid Admin JWT.
router.use(authenticate)
router.use(authorizeRole('Admin'))

router.get('/', asyncHandler(usersController.listUsers))
router.get('/roles', asyncHandler(usersController.listRoles))
router.post('/', validateRequest(createUserSchema), asyncHandler(usersController.createUser))
router.patch('/:id/status', validateRequest(updateUserStatusSchema), asyncHandler(usersController.updateUserStatus))
router.patch('/:id/archive', validateRequest(archiveUserSchema), asyncHandler(usersController.archiveUser))

module.exports = router
