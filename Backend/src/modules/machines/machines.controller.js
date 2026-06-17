const machinesService = require('./machines.service')

async function listMachines(req, res) {
  const machines = await machinesService.listMachines()
  res.json({ machines })
}

async function listSensorsByMachine(req, res) {
  const sensors = await machinesService.listSensorsByMachine(req.validated.params.id)
  res.json({ sensors })
}

async function updateMachineStatus(req, res) {
  const machine = await machinesService.updateMachineStatus({
    machineId: req.validated.params.id,
    status: req.validated.body.status,
    actorUserId: req.user.sub,
  })

  res.json({ machine })
}

async function updateSensorStatus(req, res) {
  const sensor = await machinesService.updateSensorStatus({
    sensorId: req.validated.params.id,
    status: req.validated.body.status,
    actorUserId: req.user.sub,
  })

  res.json({ sensor })
}

module.exports = {
  listMachines,
  listSensorsByMachine,
  updateMachineStatus,
  updateSensorStatus,
}
