const operationsService = require('./operations.service')

function getSseStatus(req, res) {
  res.json({ sse: operationsService.getSseStatus() })
}

module.exports = {
  getSseStatus,
}
