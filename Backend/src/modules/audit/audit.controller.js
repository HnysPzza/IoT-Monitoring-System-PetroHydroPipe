const auditService = require('./audit.service')

async function listAuditLogs(req, res) {
  const result = await auditService.listAuditLogs(req.validated.query)
  res.json(result)
}

module.exports = {
  listAuditLogs,
}
