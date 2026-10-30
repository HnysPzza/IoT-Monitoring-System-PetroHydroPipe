const productionService = require('./production.service')

async function listProductionLogs(req, res) {
  const result = await productionService.listProductionLogs(req.validated.query)
  res.set('Cache-Control', 'no-store')
  res.json(result)
}

module.exports = {
  listProductionLogs,
}

