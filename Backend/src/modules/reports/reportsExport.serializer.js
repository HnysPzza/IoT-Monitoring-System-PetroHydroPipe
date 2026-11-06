const PDFDocument = require('pdfkit')
const path = require('path')
const fs = require('fs')

const NOT_AVAILABLE = 'Not available'

const COMPANY_NAME = 'Petro Hydro Pipes Corporation'
const COMPANY_SUBTITLE = 'Spiral Welded Steel Pipe Manufacturer'
const COMPANY_ADDRESS = 'Dunggoan, Danao City 6004 Cebu, Philippines'
const COMPANY_PHONE = '(032)888-6519/+639687080116'
const COMPANY_WEBSITE = 'http://petrohydropipes.com/ph'
const SYSTEM_LABEL = 'Monitoring System'

const CANONICAL_BACKEND_LOGO = path.resolve(__dirname, '../../assets/logo.png')
const MONOREPO_FRONTEND_FALLBACK = path.resolve(__dirname, '../../../../Frontend/public/assets/logo.png')

const LOGO_PATH = process.env.REPORT_LOGO_PATH
  ? path.resolve(process.env.REPORT_LOGO_PATH)
  : (fs.existsSync(CANONICAL_BACKEND_LOGO) ? CANONICAL_BACKEND_LOGO : MONOREPO_FRONTEND_FALLBACK)

const COLOR = {
  primary: '#0F172A',
  secondary: '#1E3A8A',
  textDark: '#1E293B',
  textMuted: '#475569',
  textLight: '#64748B',
  border: '#CBD5E1',
  borderLight: '#E2E8F0',
  tableHeaderBg: '#1E293B',
  tableHeaderFg: '#FFFFFF',
  rowEven: '#F8FAFC',
  rowOdd: '#FFFFFF',
  cardBg: '#F8FAFC',
  accentBlue: '#2563EB',
}

function pdfText(value) {
  return value === null || value === undefined || value === '' ? NOT_AVAILABLE : String(value)
}

function formatDimension(value) {
  if (value === null || value === undefined || value === '') return NOT_AVAILABLE
  const num = Number(value)
  return Number.isFinite(num) ? num.toFixed(2) : NOT_AVAILABLE
}

function formatManilaDayKey(dateStr, fallbackDate) {
  if (!dateStr) return fallbackDate || 'UNDATED'
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return fallbackDate || 'UNDATED'
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    return fallbackDate || 'UNDATED'
  }
}

function formatManilaDate(dateStr) {
  if (!dateStr) return NOT_AVAILABLE
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return String(dateStr)
    return d.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) + ' PST'
  } catch {
    return String(dateStr)
  }
}

function renderOfficialHeader(doc, report) {
  const left = doc.page.margins.left
  const top = doc.page.margins.top
  const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const logoWidth = 32
  const logoHeight = 24
  const logoGap = 10
  const textLeft = fs.existsSync(LOGO_PATH) ? left + logoWidth + logoGap : left

  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, left, top + 2, { fit: [logoWidth, logoHeight] })
    } catch {
      // Fallback cleanly if the image format fails to decode
    }
  }

  // Company Brand & Facility Info
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.primary)
    .text(COMPANY_NAME, textLeft, top, { lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.textMuted)
    .text(COMPANY_SUBTITLE, textLeft, top + 13, { lineBreak: false })
  doc.font('Helvetica').fontSize(6.8).fillColor(COLOR.textLight)
    .text(COMPANY_ADDRESS, textLeft, top + 23, { lineBreak: false })
  doc.font('Helvetica').fontSize(6.8).fillColor(COLOR.textLight)
    .text(COMPANY_PHONE, textLeft, top + 32, { lineBreak: false })
  doc.font('Helvetica').fontSize(6.8).fillColor(COLOR.secondary)
    .text(COMPANY_WEBSITE, textLeft, top + 41, { lineBreak: false })

  // Right-aligned Document Title & Metadata
  const isProduction = report.category === 'production'
  const prefix = isProduction ? 'PHP-PROD' : 'PHP-RPT'
  const docTitle = isProduction ? 'OFFICIAL PRODUCTION OUTPUT REPORT' : 'OFFICIAL MONITORING REPORT'
  const refCode = `${prefix}-${(report.reportType || 'DAILY').toUpperCase()}-${(report.selectedDate || '').replace(/[^a-zA-Z0-9]/g, '') || 'UNDATED'}`
  const rightColX = left + printableWidth - 230

  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.secondary)
    .text(docTitle, rightColX, top, { width: 230, align: 'right' })
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.primary)
    .text(SYSTEM_LABEL, rightColX, top + 13, { width: 230, align: 'right' })
  doc.font('Helvetica').fontSize(6.8).fillColor(COLOR.textLight)
    .text(`Doc Ref: ${refCode}`, rightColX, top + 23, { width: 230, align: 'right' })
  doc.font('Helvetica').fontSize(6.8).fillColor(COLOR.textLight)
    .text(`Generated: ${formatManilaDate(report.generatedAt)}`, rightColX, top + 32, { width: 230, align: 'right' })

  // Top Rule Divider
  const dividerY = top + 52
  doc.moveTo(left, dividerY).lineTo(left + printableWidth, dividerY)
    .lineWidth(1.5).strokeColor(COLOR.secondary).stroke()

  doc.y = dividerY + 10
}

function renderMetadataCard(doc, report) {
  const left = doc.page.margins.left
  const cardY = doc.y
  const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const cardHeight = 44

  doc.roundedRect(left, cardY, printableWidth, cardHeight, 4)
    .fillAndStroke(COLOR.cardBg, COLOR.border)

  const colWidth = printableWidth / 4
  const paddingX = 8
  const paddingY = 8

  const metaItems = report.category === 'production'
    ? [
      { label: 'REPORT TYPE & DATE', val: `${(report.reportType || 'Daily').toUpperCase()} (${pdfText(report.selectedDate)})` },
      { label: 'OBSERVATION STATUS', val: (report.periodState || 'complete').toUpperCase() },
      { label: 'SYSTEM', val: SYSTEM_LABEL },
      { label: 'CUTTING SENSOR', val: report.sensor?.label || 'S-05 Cutting Sensor' },
    ]
    : [
      { label: 'REPORT TYPE & DATE', val: `${(report.reportType || 'Daily').toUpperCase()} (${pdfText(report.selectedDate)})` },
      { label: 'OBSERVATION STATUS', val: (report.periodState || 'complete').toUpperCase() },
      { label: 'SYSTEM', val: SYSTEM_LABEL },
      { label: 'LOSS ESTIMATE BASIS', val: `${Math.ceil((report.lossEstimateBasis?.ratePiecesPerMinute ?? 0.05) * 60)} pcs/hr (${report.lossEstimateBasis?.source || 'configured'})` },
    ]

  metaItems.forEach((item, index) => {
    const colX = left + (index * colWidth) + paddingX
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COLOR.textLight)
      .text(item.label, colX, cardY + paddingY, { width: colWidth - (paddingX * 2), lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLOR.textDark)
      .text(item.val, colX, cardY + paddingY + 11, { width: colWidth - (paddingX * 2), lineBreak: true, ellipsis: true })
  })

  doc.y = cardY + cardHeight + 14
}

function renderSectionHeader(doc, title) {
  const left = doc.page.margins.left
  const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLOR.primary)
    .text(title, left, doc.y)
  doc.moveDown(0.2)
  doc.moveTo(left, doc.y).lineTo(left + printableWidth, doc.y)
    .lineWidth(0.75).strokeColor(COLOR.borderLight).stroke()
  doc.moveDown(0.4)
}

function renderGenericTable(doc, { columns, rows, emptyNotice, onNewPage }) {
  const left = doc.page.margins.left
  const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const headerHeight = 20

  function drawHeader() {
    const headerY = doc.y
    doc.rect(left, headerY, printableWidth, headerHeight).fill(COLOR.tableHeaderBg)
    let currentX = left
    columns.forEach((col) => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.tableHeaderFg)
        .text(col.label, currentX + 6, headerY + 5, {
          width: col.width - 12,
          align: col.align || 'left',
          lineBreak: false,
        })
      currentX += col.width
    })
    doc.y = headerY + headerHeight
  }

  drawHeader()

  if (!rows || rows.length === 0) {
    const rowHeight = 22
    doc.rect(left, doc.y, printableWidth, rowHeight).fill(COLOR.rowOdd)
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLOR.textLight)
      .text(emptyNotice || 'No records reported for this category.', left + 8, doc.y + 6, {
        width: printableWidth - 16,
        align: 'center',
      })
    doc.moveTo(left, doc.y + rowHeight).lineTo(left + printableWidth, doc.y + rowHeight)
      .lineWidth(0.5).strokeColor(COLOR.borderLight).stroke()
    doc.y += rowHeight + 8
    return
  }

  rows.forEach((row, rowIndex) => {
    let maxContentHeight = 0
    row.forEach((cellVal, colIndex) => {
      const col = columns[colIndex]
      doc.font(col.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
      const textHeight = doc.heightOfString(pdfText(cellVal), { width: col.width - 12 })
      if (textHeight > maxContentHeight) maxContentHeight = textHeight
    })

    const rowHeight = Math.max(maxContentHeight + 8, 18)

    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage()
      doc.y = doc.page.margins.top + 8
      if (onNewPage) onNewPage()
      drawHeader()
    }

    const rowY = doc.y
    const isEven = rowIndex % 2 === 1
    doc.rect(left, rowY, printableWidth, rowHeight).fill(isEven ? COLOR.rowEven : COLOR.rowOdd)

    let currentX = left
    row.forEach((cellVal, colIndex) => {
      const col = columns[colIndex]
      const text = pdfText(cellVal)
      doc.font(col.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor(col.color || COLOR.textDark)
        .text(text, currentX + 6, rowY + 4, {
          width: col.width - 12,
          align: col.align || 'left',
          lineBreak: true,
        })
      currentX += col.width
    })

    doc.moveTo(left, rowY + rowHeight).lineTo(left + printableWidth, rowY + rowHeight)
      .lineWidth(0.5).strokeColor(COLOR.borderLight).stroke()

    doc.y = rowY + rowHeight
  })

  doc.y += 10
}

function renderSignoffBlock(doc) {
  const left = doc.page.margins.left
  const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const blockHeight = 52

  if (doc.y + blockHeight > doc.page.height - doc.page.margins.bottom - 35) {
    doc.addPage()
  }

  doc.moveDown(0.5)
  const signY = doc.y
  const colWidth = printableWidth / 3

  const signoffs = [
    { role: 'PREPARED BY', title: 'IoT Telemetry Ingestion Engine', note: 'Automated System Signature' },
    { role: 'REVIEWED BY', title: 'Operation Manager', note: 'Production Operations Lead' },
    { role: 'APPROVED BY', title: 'Managing Director', note: 'Executive Plant Administration' },
  ]

  signoffs.forEach((sign, index) => {
    const colX = left + (index * colWidth)
    doc.moveTo(colX + 10, signY + 30).lineTo(colX + colWidth - 10, signY + 30)
      .lineWidth(0.75).strokeColor(COLOR.border).stroke()
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.textDark)
      .text(sign.role, colX + 10, signY + 33, { width: colWidth - 20, align: 'center' })
    doc.font('Helvetica').fontSize(6.8).fillColor(COLOR.textLight)
      .text(sign.title, colX + 10, signY + 43, { width: colWidth - 20, align: 'center' })
  })

  doc.y = signY + blockHeight
}

function renderProductionSections(doc, report, printableWidth) {
  // 1. Production Output Summary Table
  renderSectionHeader(doc, '1. Production Output Summary')

  const summaryColumns = [
    { label: 'Key Performance Metric', width: 180, bold: true },
    { label: 'Recorded Value', width: 110, align: 'right', bold: true, color: COLOR.primary },
    { label: 'Operational Reference', width: printableWidth - 290, color: COLOR.textMuted },
  ]

  const summaryRows = (report.summary || []).map((item) => [
    item.label,
    item.value,
    item.helper,
  ])

  renderGenericTable(doc, {
    columns: summaryColumns,
    rows: summaryRows,
    emptyNotice: 'No production metrics recorded for this period.',
  })

  // 2. Production Breakdown by Pipe Specification Table
  if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
    doc.addPage()
  }

  renderSectionHeader(doc, '2. Production Breakdown by Pipe Specification')

  const specColumns = [
    { label: 'Customer', width: 110, bold: true },
    { label: 'Diameter (OD)', width: 70, align: 'right' },
    { label: 'Thickness (mm)', width: 65, align: 'right' },
    { label: 'Length (mm)', width: 65, align: 'right' },
    { label: 'Quantity (pcs)', width: 65, align: 'right', bold: true, color: COLOR.secondary },
    { label: 'Total Tons', width: 75, align: 'right', bold: true },
    { label: '% of Total', width: 73.28, align: 'right' },
  ]

  const specBreakdown = Array.isArray(report.specBreakdown) ? report.specBreakdown : []
  const specRows = specBreakdown.map((group) => {
    const customerText = group.customer || (group.isSpecified === false ? 'Unspecified / Pending Tag' : (group.label || NOT_AVAILABLE))
    const diameterText = formatDimension(group.diameter)
    const thicknessText = formatDimension(group.thickness)
    const lengthText = formatDimension(group.length)
    const countText = `${group.pipeCount} pcs`
    const tonsText = group.totalTonnage != null && Number.isFinite(Number(group.totalTonnage))
      ? Number(group.totalTonnage).toFixed(4)
      : NOT_AVAILABLE
    const pctText = group.percentageOfTotal != null && Number.isFinite(Number(group.percentageOfTotal))
      ? `${Number(group.percentageOfTotal).toFixed(1)}%`
      : '0.0%'

    return [customerText, diameterText, thicknessText, lengthText, countText, tonsText, pctText]
  })

  if (specRows.length > 0) {
    const totalTons = report.totalTonnage != null && Number.isFinite(Number(report.totalTonnage))
      ? Number(report.totalTonnage).toFixed(4)
      : '-'
    specRows.push([
      'TOTAL ACCEPTED OUTPUT',
      '-',
      '-',
      '-',
      `${report.totalProductionOutput ?? 0} pcs`,
      totalTons,
      '100.0%',
    ])
  }

  renderGenericTable(doc, {
    columns: specColumns,
    rows: specRows,
    emptyNotice: 'No accepted pipe cutting events recorded for this period.',
    onNewPage: () => {
      renderSectionHeader(doc, '2. Production Breakdown by Pipe Specification (Continued)')
    },
  })

  // 3. Chronological Pipe Cut Log (S-05)
  if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
    doc.addPage()
  }

  renderSectionHeader(doc, '3. Chronological Pipe Cut Log (S-05)')

  const logColumns = [
    { label: 'Cut Timestamp (PST)', width: 110 },
    { label: 'Customer', width: 95 },
    { label: 'Diameter (OD)', width: 65, align: 'right' },
    { label: 'Thickness', width: 60, align: 'right' },
    { label: 'Length', width: 60, align: 'right' },
    { label: 'Pipe #', width: 65, align: 'center' },
    { label: 'Tons', width: 68.28, align: 'right' },
  ]

  const logs = Array.isArray(report.productionLogs) ? report.productionLogs : []
  const logRows = []
  let currentDayKey = null
  let dailyPipeCount = 0
  let dailyTonnage = 0

  logs.forEach((log, index) => {
    const dayKey = formatManilaDayKey(log.recordedAt, report.selectedDate)
    if (currentDayKey === null) {
      currentDayKey = dayKey
    }

    dailyPipeCount += 1
    const tonNum = Number(log.tonnage)
    if (log.tonnage != null && Number.isFinite(tonNum) && tonNum > 0) {
      dailyTonnage += tonNum
    }

    const timestampText = formatManilaDate(log.recordedAt)
    const customerText = log.customer || (log.isSpecified ? (log.label || NOT_AVAILABLE) : 'Pending Tag')
    const diameterText = formatDimension(log.diameter)
    const thicknessText = formatDimension(log.thickness)
    const lengthText = formatDimension(log.length)
    const pipeNumberVal = log.pipeNumber != null
      ? log.pipeNumber
      : (log.deviceEventId ?? (log.id ? String(log.id).slice(0, 8) : null))
    const pipeNumberText = pipeNumberVal != null
      ? (typeof pipeNumberVal === 'number' ? `#${pipeNumberVal}` : String(pipeNumberVal))
      : NOT_AVAILABLE
    const tonsText = log.tonnage != null && Number.isFinite(tonNum)
      ? tonNum.toFixed(4)
      : NOT_AVAILABLE

    logRows.push([timestampText, customerText, diameterText, thicknessText, lengthText, pipeNumberText, tonsText])

    const nextLog = logs[index + 1]
    const nextDayKey = nextLog ? formatManilaDayKey(nextLog.recordedAt, report.selectedDate) : null

    if (nextDayKey !== dayKey) {
      const roundedDailyTons = Math.round(dailyTonnage * 10000) / 10000
      logRows.push([
        `DAILY TOTAL (${dayKey})`,
        '-',
        '-',
        '-',
        '-',
        `${dailyPipeCount} pcs`,
        roundedDailyTons.toFixed(4),
      ])
      currentDayKey = nextDayKey
      dailyPipeCount = 0
      dailyTonnage = 0
    }
  })

  renderGenericTable(doc, {
    columns: logColumns,
    rows: logRows,
    emptyNotice: 'No individual pipe cuts registered for this period.',
    onNewPage: () => {
      renderSectionHeader(doc, '3. Chronological Pipe Cut Log (Continued)')
    },
  })
}

function renderRegularSections(doc, report, printableWidth) {
  // 1. Key Performance & Operational Summary Table
  renderSectionHeader(doc, '1. Operational Performance & Loss Summary')

  const summaryColumns = [
    { label: 'Key Performance Metric', width: 180, bold: true },
    { label: 'Recorded Value', width: 110, align: 'right', bold: true, color: COLOR.primary },
    { label: 'Engineering Telemetry Reference', width: printableWidth - 290, color: COLOR.textMuted },
  ]

  const summaryRows = (report.summary || []).map((item) => [
    item.label,
    item.value,
    item.helper,
  ])

  renderGenericTable(doc, {
    columns: summaryColumns,
    rows: summaryRows,
    emptyNotice: 'No operational metrics calculated for this period.',
  })

  // 2. Process Sensor Telemetry (Station Pulses)
  if (report.processSensors && report.processSensors.length > 0) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
      doc.addPage()
    }

    renderSectionHeader(doc, '2. Process Sensor Pulse Telemetry')

    const sensorColumns = [
      { label: 'Sensor Code', width: 80, bold: true, color: COLOR.secondary },
      { label: 'Machine Station / Sensor Function', width: printableWidth - 200 },
      { label: 'Recorded Events / Pulses', width: 120, align: 'right', bold: true },
    ]

    const sensorRows = report.processSensors.map((s) => [
      s.sensorCode,
      s.sensorLabel,
      s.eventCount !== null && s.eventCount !== undefined ? `${s.eventCount} pulses` : NOT_AVAILABLE,
    ])

    renderGenericTable(doc, {
      columns: sensorColumns,
      rows: sensorRows,
      emptyNotice: 'No process sensor pulse activity recorded.',
    })
  }

  // 3. Downtime & Production Loss Attribution Breakdown Table
  if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
    doc.addPage()
  }

  renderSectionHeader(doc, '3. Downtime Incident & Production Loss Attribution')

  const downtimeColumns = [
    { label: 'Downtime Cause / Description', width: 170, bold: true },
    { label: 'Attributed Sensor', width: 143.28 },
    { label: 'Events', width: 50, align: 'right' },
    { label: 'Duration (min)', width: 80, align: 'right' },
    { label: 'Est. Loss (pcs)', width: 80, align: 'right', bold: true, color: COLOR.secondary },
  ]

  const downtimeRows = (report.rows || []).map((row) => [
    row.cause,
    row.sensor,
    row.events,
    row.durationMinutes,
    row.estimatedLoss,
  ])

  if (downtimeRows.length > 0) {
    const totalEvents = report.rows.reduce((sum, r) => sum + (Number(r.events) || 0), 0)
    const totalDuration = report.rows.reduce((sum, r) => sum + (Number(r.durationMinutes) || 0), 0)
    const totalLoss = report.rows.reduce((sum, r) => sum + (Number(r.estimatedLoss) || 0), 0).toFixed(1)

    downtimeRows.push([
      'TOTAL ATTRIBUTED DOWNTIME',
      'All Operational Stations',
      totalEvents,
      `${totalDuration} min`,
      `${totalLoss} pcs`,
    ])
  }

  renderGenericTable(doc, {
    columns: downtimeColumns,
    rows: downtimeRows,
    emptyNotice: 'No machine downtime incidents recorded for this period.',
    onNewPage: () => {
      renderSectionHeader(doc, '3. Downtime Incident & Production Loss Attribution (Continued)')
    },
  })
}

// ponytail: synchronous in-memory buffer ceiling: 10k events upgrade: stream via PassThrough to response
function toPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      bufferPages: true,
    })

    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    // 1. Official Header & Metadata Banner
    renderOfficialHeader(doc, report)
    renderMetadataCard(doc, report)

    // 2. Report Sections (Production vs Regular)
    if (report.category === 'production') {
      renderProductionSections(doc, report, printableWidth)
    } else {
      renderRegularSections(doc, report, printableWidth)
    }

    // 3. Official Certification / Signoff
    renderSignoffBlock(doc)

    // 4. Running Page Headers and Footers
    const range = doc.bufferedPageRange()
    const reportTitle = report.category === 'production'
      ? 'Official Production Output Report'
      : 'Official Monitoring Report'

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)

      const savedTopMargin = doc.page.margins.top
      const savedBottomMargin = doc.page.margins.bottom
      doc.page.margins.top = 0
      doc.page.margins.bottom = 0

      // Header on continuation pages (Page 2 and beyond)
      if (i > range.start) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.textLight)
          .text(`${COMPANY_NAME} • ${reportTitle} (${pdfText(report.selectedDate)})`, doc.page.margins.left, 20, {
            width: printableWidth,
            align: 'left',
            lineBreak: false,
          })
        doc.moveTo(doc.page.margins.left, 30).lineTo(doc.page.margins.left + printableWidth, 30)
          .lineWidth(0.5).strokeColor(COLOR.borderLight).stroke()
      }

      // Footer on all pages
      const footerY = doc.page.height - 25
      doc.moveTo(doc.page.margins.left, footerY - 5).lineTo(doc.page.margins.left + printableWidth, footerY - 5)
        .lineWidth(0.5).strokeColor(COLOR.borderLight).stroke()

      doc.font('Helvetica').fontSize(6.8).fillColor(COLOR.textLight)
        .text(`CONFIDENTIAL • ${COMPANY_NAME} • ${COMPANY_ADDRESS}`, doc.page.margins.left, footerY, {
          width: printableWidth - 100,
          align: 'left',
          lineBreak: false,
        })
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(COLOR.textLight)
        .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left + printableWidth - 90, footerY, {
          width: 90,
          align: 'right',
          lineBreak: false,
        })

      doc.page.margins.top = savedTopMargin
      doc.page.margins.bottom = savedBottomMargin
    }

    doc.end()
  })
}

function buildExportFilename({ category = 'regular', reportType, selectedDate, format }) {
  const prefix = category === 'production' ? 'production-report' : 'report'
  const raw = `${prefix}-${reportType}-${selectedDate || 'undated'}.${format}`
  return raw.replace(/[^a-zA-Z0-9._-]/g, '')
}

function contentTypeFor(format) {
  if (format === 'pdf') return 'application/pdf'
  if (format === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  throw new TypeError(`Unsupported report export format: ${format}`)
}

module.exports = {
  buildExportFilename,
  contentTypeFor,
  toPdf,
}
