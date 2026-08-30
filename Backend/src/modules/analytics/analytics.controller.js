const analyticsService = require('./analytics.service')

async function getAnalytics(req, res) {
  const analytics = await analyticsService.getAnalytics(req.validated.query)
  res.set('Cache-Control', 'no-store')
  res.json({ analytics })
}

module.exports = { getAnalytics }
