const machinesService = require('./machines.service')

async function listMachines(req, res) {
  const machines = await machinesService.listMachines()
  res.json({ machines })
}

async function listSensorsByMachine(req, res) {
  const sensors = await machinesService.listSensorsByMachine(req.validated.params.id)
  res.json({ sensors })
}

module.exports = {
  listMachines,
  listSensorsByMachine,
}
