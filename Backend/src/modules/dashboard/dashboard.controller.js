const dashboardService = require('./dashboard.service')

async function getOverview(req, res) {
  const overview = await dashboardService.getOverview(req.validated.query)
  res.set('Cache-Control', 'no-store')
  res.json(overview)
}

async function getDowntimeImpact(req, res) {
  const downtimeImpact = await dashboardService.getDowntimeImpact(req.validated.query)
  res.set('Cache-Control', 'no-store')
  res.json({ downtimeImpact })
}

module.exports = {
  getDowntimeImpact,
  getOverview,
}
