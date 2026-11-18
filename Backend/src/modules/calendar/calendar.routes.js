const express = require('express')
const authenticate = require('../../middleware/authenticate')
const authorizeRole = require('../../middleware/authorizeRole')
const validateRequest = require('../../middleware/validateRequest')
const asyncHandler = require('../../utils/asyncHandler')
const calendarController = require('./calendar.controller')
const {
  deleteCalendarDaySchema,
  deleteCalendarRangeSchema,
  getCalendarQuerySchema,
  postCalendarRangeSchema,
  putCalendarDaySchema,
} = require('./calendar.model')

const router = express.Router({ mergeParams: true })
const dashboardRoles = [
  'Admin',
  'Operation Manager',
  'Quality Control',
  'Engineering Supervisor',
  'Production Supervisor',
]

const calendarEditRoles = ['Admin', 'Engineering Supervisor']

router.use(authenticate)

router.get(
  '/',
  authorizeRole(dashboardRoles),
  validateRequest(getCalendarQuerySchema),
  asyncHandler(calendarController.getProductionCalendar),
)

router.put(
  '/days/:calendarDate',
  authorizeRole(calendarEditRoles),
  validateRequest(putCalendarDaySchema),
  asyncHandler(calendarController.setProductionCalendarDay),
)

router.post(
  ['/ranges', '/range'],
  authorizeRole(calendarEditRoles),
  validateRequest(postCalendarRangeSchema),
  asyncHandler(calendarController.setProductionCalendarRange),
)

router.delete(
  '/days/:calendarDate',
  authorizeRole(calendarEditRoles),
  validateRequest(deleteCalendarDaySchema),
  asyncHandler(calendarController.removeProductionCalendarDay),
)

router.delete(
  ['/groups/:groupId', '/ranges/:groupId'],
  authorizeRole(calendarEditRoles),
  validateRequest(deleteCalendarRangeSchema),
  asyncHandler(calendarController.removeProductionCalendarRange),
)

router.use((err, req, res, next) => {
  if (res.headersSent || !err?.details || (err.status && err.status >= 500)) {
    return next(err)
  }

  const status = err.status || err.statusCode || 400
  return res.status(status).json({
    error: {
      code: err.code || 'REQUEST_ERROR',
      message: err.message,
      details: err.details,
    },
  })
})

module.exports = router
