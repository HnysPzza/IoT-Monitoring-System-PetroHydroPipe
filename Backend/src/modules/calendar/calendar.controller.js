const calendarService = require('./calendar.service')

async function getProductionCalendar(req, res) {
  const entries = await calendarService.getProductionCalendar({
    machineId: req.validated.params.machineId,
    from: req.validated.query.from,
    to: req.validated.query.to,
  })
  res.set('Cache-Control', 'no-store')
  res.json({ entries })
}

async function setProductionCalendarDay(req, res) {
  const entry = await calendarService.setProductionCalendarDay({
    machineId: req.validated.params.machineId,
    calendarDate: req.validated.params.calendarDate,
    dayType: req.validated.body.dayType,
    name: req.validated.body.name,
    isWorking: req.validated.body.isWorking,
    reason: req.validated.body.reason,
    expectedVersion: req.validated.body.expectedVersion,
    confirmOverwrite: req.validated.body.confirmOverwrite,
    actorUserId: req.user.sub,
  })
  res.set('Cache-Control', 'no-store')
  res.json({ entry })
}

async function setProductionCalendarRange(req, res) {
  const { groupId, entries } = await calendarService.setProductionCalendarRange({
    machineId: req.validated.params.machineId,
    startDate: req.validated.body.startDate,
    endDate: req.validated.body.endDate,
    dayType: req.validated.body.dayType,
    name: req.validated.body.name,
    reason: req.validated.body.reason,
    confirmOverwrite: req.validated.body.confirmOverwrite,
    groupId: req.validated.body.groupId,
    actorUserId: req.user.sub,
  })
  res.set('Cache-Control', 'no-store')
  res.json({ groupId, entries })
}

async function removeProductionCalendarDay(req, res) {
  const result = await calendarService.removeProductionCalendarDay({
    machineId: req.validated.params.machineId,
    calendarDate: req.validated.params.calendarDate,
    actorUserId: req.user.sub,
  })
  res.set('Cache-Control', 'no-store')
  res.json({ result })
}

async function removeProductionCalendarRange(req, res) {
  const result = await calendarService.removeProductionCalendarRange({
    machineId: req.validated.params.machineId,
    groupId: req.validated.params.groupId,
    actorUserId: req.user.sub,
  })
  res.set('Cache-Control', 'no-store')
  res.json({ result })
}

module.exports = {
  getProductionCalendar,
  removeProductionCalendarDay,
  removeProductionCalendarRange,
  setProductionCalendarDay,
  setProductionCalendarRange,
}
