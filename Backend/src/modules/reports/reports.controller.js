const reportsService = require('./reports.service')
const { recordAuditLog } = require('../audit/audit.service')
const {
  buildExportFilename,
  contentTypeFor,
  toCsv,
  toPdf,
} = require('./reportsExport.serializer')

async function getSummary(req, res) {
  const report = await reportsService.getSummary(req.validated.query)
  res.set('Cache-Control', 'no-store')
  res.json({ report })
}

async function exportReport(req, res) {
  const { type, date, format } = req.validated.body
  const report = await reportsService.getSummary({ type, date })

  const content = format === 'pdf' ? await toPdf(report) : Buffer.from(toCsv(report), 'utf8')
  const filename = buildExportFilename({
    reportType: type,
    selectedDate: report.selectedDate,
    format,
  })

  await recordAuditLog({
    userId: req.authenticatedUser.id,
    action: 'REPORT_EXPORTED',
    entityType: 'report',
    metadata: {
      reportType: type,
      selectedDate: report.selectedDate,
      format,
      rowCount: report.rows.length,
      periodState: report.periodState,
      observedStartAt: report.observedStartAt,
      observedEndAt: report.observedEndAt,
    },
  })

  res.set('Cache-Control', 'no-store')
  res.set('Content-Type', contentTypeFor(format))
  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(content)
}

module.exports = {
  exportReport,
  getSummary,
}
