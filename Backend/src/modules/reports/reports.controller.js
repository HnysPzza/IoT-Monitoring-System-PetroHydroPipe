const reportsService = require('./reports.service')

async function getSummary(req, res) {
  const report = await reportsService.getSummary(req.validated.query)
  res.set('Cache-Control', 'no-store')
  res.json({ report })
}

module.exports = {
  getSummary,
}
