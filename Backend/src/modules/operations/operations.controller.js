const operationsService = require('./operations.service')

function getSseStatus(req, res) {
  res.json({ sse: operationsService.getSseStatus() })
}

function getWatchdogStatus(req, res) {
  res.json({ watchdog: operationsService.getWatchdogStatus() })
}

module.exports = {
  getSseStatus,
  getWatchdogStatus,
}
