const reportsService = require('./reports.service')
const { recordAuditLog } = require('../audit/audit.service')
const { toXlsx } = require('./reportsXlsx.serializer')
const {
  buildExportFilename,
  contentTypeFor,
  toPdf,
} = require('./reportsExport.serializer')

async function getSummary(req, res) {
  const report = await reportsService.getSummary(req.validated.query, { maxLogs: 200 })
  res.set('Cache-Control', 'no-store')
  res.json({ report })
}

async function exportReport(req, res) {
  const { category = 'regular', type, date, format } = req.validated.body
  const report = await reportsService.getSummary({ category, type, date }, { isExport: true, maxLogs: null })

  const content = format === 'pdf'
    ? await toPdf(report)
    : await toXlsx(report)
  const filename = buildExportFilename({
    category: report.category || category,
    reportType: type,
    selectedDate: report.selectedDate,
    format,
  })

  await recordAuditLog({
    userId: req.authenticatedUser.id,
    action: 'REPORT_EXPORTED',
    entityType: 'report',
    metadata: {
      reportCategory: report.category || category,
      reportType: type,
      selectedDate: report.selectedDate,
      format,
      rowCount: report.category === 'production'
        ? (report.productionLogs?.length ?? report.rows?.length ?? 0)
        : (report.rows?.length ?? 0),
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
