const reportsService = require('./reports.service')
const { recordAuditLog } = require('../audit/audit.service')
const { toXlsx } = require('./reportsXlsx.serializer')
const {
  buildExportFilename,
  contentTypeFor,
  toPdf,
} = require('./reportsExport.serializer')

const MAX_CONCURRENT_EXPORTS = 2
const MAX_QUEUED_EXPORTS = 8
const MAX_PDF_EXPORT_LOGS = 10_000
const MAX_XLSX_EXPORT_LOGS = 25_000
// ponytail: process-local semaphore; move to distributed queue before multi-instance.
let activeExports = 0
const exportWaiters = []

async function acquireExportSlot() {
  if (activeExports < MAX_CONCURRENT_EXPORTS) {
    activeExports += 1
    return true
  }
  if (exportWaiters.length >= MAX_QUEUED_EXPORTS) {
    return false
  }
  await new Promise((resolve) => exportWaiters.push(resolve))
  return true
}

function releaseExportSlot() {
  if (exportWaiters.length > 0) {
    const next = exportWaiters.shift()
    next()
    return
  }
  activeExports = Math.max(0, activeExports - 1)
}

async function getSummary(req, res) {
  const report = await reportsService.getSummary(req.validated.query, { maxLogs: 200 })
  res.set('Cache-Control', 'no-store')
  res.json({ report })
}

async function exportReport(req, res) {
  if (!(await acquireExportSlot())) {
    return res.set('Retry-After', '5').status(429).json({
      error: {
        code: 'EXPORT_BUSY',
        message: 'Report export is busy. Please retry shortly.',
      },
    })
  }

  try {
    if (res.destroyed || res.writableEnded || res.headersSent) return

    const { category = 'regular', type, date, format } = req.validated.body
    const maxLogs = format === 'pdf' ? MAX_PDF_EXPORT_LOGS : MAX_XLSX_EXPORT_LOGS
    const report = await reportsService.getSummary({ category, type, date }, { isExport: true, maxLogs })

    if (res.destroyed || res.writableEnded || res.headersSent) return

    const content = format === 'pdf'
      ? await toPdf(report)
      : await toXlsx(report)

    if (res.destroyed || res.writableEnded || res.headersSent) return

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

    if (res.destroyed || res.writableEnded || res.headersSent) return

    res.set('Cache-Control', 'no-store')
    res.set('Content-Type', contentTypeFor(format))
    res.set('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(content)
  } finally {
    releaseExportSlot()
  }
}

module.exports = {
  exportReport,
  getSummary,
}
