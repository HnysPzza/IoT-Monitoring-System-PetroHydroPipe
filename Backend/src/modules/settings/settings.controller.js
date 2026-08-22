const settingsService = require('./settings.service')

async function getMachineSettings(req, res) {
  const settings = await settingsService.getMachineSettings(req.validated.params.machineId)
  res.json({ settings })
}

async function updateMachineSettings(req, res) {
  const settings = await settingsService.updateMachineSettings({
    machineId: req.validated.params.machineId,
    expectedVersion: req.validated.body.expectedVersion,
    sensorThresholds: req.validated.body.sensorThresholds,
    shiftSchedule: req.validated.body.shiftSchedule,
    actorUserId: req.user.sub,
  })
  res.json({ settings })
}

module.exports = {
  getMachineSettings,
  updateMachineSettings,
}
