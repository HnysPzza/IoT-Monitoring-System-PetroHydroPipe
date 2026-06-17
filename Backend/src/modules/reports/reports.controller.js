const reportsService = require('./reports.service')

async function getSummary(req, res) {
  const report = await reportsService.getSummary(req.validated.query)
  res.json({ report })
}

module.exports = {
  getSummary,
}
