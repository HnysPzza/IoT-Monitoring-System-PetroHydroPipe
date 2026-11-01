const productionService = require('./production.service')

async function listProductionLogs(req, res) {
  const result = await productionService.listProductionLogs(req.validated.query)
  res.set('Cache-Control', 'no-store')
  res.json(result)
}

async function updateProductionLogSpec(req, res) {
  const result = await productionService.updateProductionLogSpec({
    eventId: req.validated.params.eventId,
    payload: req.validated.body,
    actorUserId: req.user.id,
  })
  res.set('Cache-Control', 'no-store')
  res.json(result)
}

async function batchUpdateProductionLogSpecs(req, res) {
  const result = await productionService.batchUpdateProductionLogSpecs({
    payload: req.validated.body,
    actorUserId: req.user.id,
  })
  res.set('Cache-Control', 'no-store')
  res.json(result)
}

module.exports = {
  listProductionLogs,
  updateProductionLogSpec,
  batchUpdateProductionLogSpecs,
}
