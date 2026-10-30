const ExcelJS = require('exceljs')

const COLOR = {
  ink: 'FF1F3A5F',
  rule: 'FFE4E9EF',
  paper: 'FFFFFFFF',
}

const THIN_RULE = { style: 'thin', color: { argb: COLOR.rule } }

function numericValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numberFormatFor(value, numberFormat) {
  return Number.isInteger(value) ? numberFormat.replace(/\.#+/, '') : numberFormat
}

function summaryNumber(report, id) {
  const value = report.summary?.find((item) => item.id === id)?.value
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replaceAll(',', ''))
  return Number.isFinite(parsed) ? parsed : null
}

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().slice(0, 10) === value ? date : null
}

function formatManilaDate(dateStr) {
  if (!dateStr) return 'N/A'
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

function setNumber(cell, value, numberFormat) {
  cell.value = numericValue(value) ?? 'N/A'
  if (typeof cell.value === 'number') cell.numFmt = numberFormatFor(cell.value, numberFormat)
}

function styleLabel(cell) {
  cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: COLOR.ink } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
}

function styleTableHeader(row) {
  row.height = 23
  row.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.paper } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.ink } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
}

function styleTableBody(row) {
  row.height = 22
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    cell.border = { bottom: THIN_RULE }
  })
}

async function renderProductionWorkbook(workbook, report) {
  workbook.creator = 'PetroHydroPipe Operations'
  workbook.subject = 'Production Output Report'
  workbook.title = 'Production Output Report'

  // Worksheet 1: Production Summary
  const summarySheet = workbook.addWorksheet('Production Summary', {
    properties: { defaultRowHeight: 20 },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })

  summarySheet.columns = [
    { width: 32 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
    { width: 18 },
    { width: 16 },
  ]
  summarySheet.views = [{ state: 'frozen', ySplit: 3, topLeftCell: 'A4', activeCell: 'A4', showGridLines: false }]

  summarySheet.mergeCells('A2:G2')
  summarySheet.getCell('A2').value = 'PETRO HYDRO PIPE CORP.  |  Production Output Report'
  summarySheet.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: COLOR.ink } }
  summarySheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' }
  summarySheet.getRow(2).height = 25

  summarySheet.mergeCells('A3:D3')
  const reportTypeLabel = report.reportType
    ? String(report.reportType).charAt(0).toUpperCase() + String(report.reportType).slice(1) + ' report'
    : 'Production Output Report'
  summarySheet.getCell('A3').value = reportTypeLabel
  summarySheet.getCell('A3').font = { name: 'Arial', size: 18, bold: true, color: { argb: COLOR.ink } }
  summarySheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  summarySheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left' }

  summarySheet.mergeCells('E3:G3')
  const machineLabel = report.machine?.name
    ? `${report.machine.name} (${report.machine.code || 'M-01'})`
    : 'Spiral Mill 01 (M-01)'
  summarySheet.getCell('E3').value = machineLabel
  summarySheet.getCell('E3').font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
  summarySheet.getCell('E3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  summarySheet.getCell('E3').alignment = { vertical: 'middle', horizontal: 'right' }
  summarySheet.getRow(3).height = 34

  summarySheet.getCell('A4').value = 'Period'
  styleLabel(summarySheet.getCell('A4'))
  summarySheet.getCell('B4').value = dateValue(report.selectedDate) || report.selectedDate || 'N/A'
  if (summarySheet.getCell('B4').value instanceof Date) summarySheet.getCell('B4').numFmt = 'mmm d, yyyy'
  summarySheet.getCell('B4').alignment = { vertical: 'middle', horizontal: 'left' }

  summarySheet.getCell('C4').value = 'Observation'
  styleLabel(summarySheet.getCell('C4'))
  summarySheet.getCell('D4').value = report.periodState
    ? String(report.periodState).charAt(0).toUpperCase() + String(report.periodState).slice(1)
    : 'N/A'
  summarySheet.getCell('D4').font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
  summarySheet.getCell('D4').alignment = { vertical: 'middle', horizontal: 'left' }

  summarySheet.getCell('E4').value = 'Target Station'
  styleLabel(summarySheet.getCell('E4'))
  summarySheet.mergeCells('F4:G4')
  summarySheet.getCell('F4').value = report.sensor?.label || 'S-05 Cutting Sensor'
  summarySheet.getCell('F4').font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
  summarySheet.getCell('F4').alignment = { vertical: 'middle', horizontal: 'left' }

  summarySheet.getCell('A5').value = 'Generated (UTC)'
  styleLabel(summarySheet.getCell('A5'))
  summarySheet.mergeCells('B5:C5')
  const generatedAt = typeof report.generatedAt === 'string' ? new Date(report.generatedAt) : null
  summarySheet.getCell('B5').value = generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : 'N/A'
  if (summarySheet.getCell('B5').value instanceof Date) summarySheet.getCell('B5').numFmt = 'mmm d, yyyy hh:mm AM/PM'
  summarySheet.getCell('B5').alignment = { vertical: 'middle', horizontal: 'left' }

  summarySheet.getCell('D5').value = 'Tag Coverage'
  styleLabel(summarySheet.getCell('D5'))
  summarySheet.mergeCells('E5:G5')
  const totalOut = numericValue(report.metrics?.totalProductionOutput)
  const specPipes = numericValue(report.metrics?.specifiedPipes)
  const coveragePercent = totalOut && totalOut > 0 && specPipes !== null
    ? `${Math.round((specPipes / totalOut) * 100)}% tagged`
    : 'N/A'
  summarySheet.getCell('E5').value = coveragePercent
  summarySheet.getCell('E5').font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
  summarySheet.getCell('E5').alignment = { vertical: 'middle', horizontal: 'left' }

  summarySheet.mergeCells('A7:G7')
  summarySheet.getCell('A7').value = 'Period Summary'
  summarySheet.getCell('A7').font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
  summarySheet.getCell('A7').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  summarySheet.getCell('A7').border = { bottom: { style: 'thin', color: { argb: COLOR.ink } } }

  const summaryGrid = [
    [
      ['Total Production Output', numericValue(report.metrics?.totalProductionOutput), '#,##0 "pcs"'],
      ['Specified Pipes', numericValue(report.metrics?.specifiedPipes), '#,##0 "pcs"'],
    ],
    [
      ['Unspecified Pipes', numericValue(report.metrics?.unspecifiedPipes), '#,##0 "pcs"'],
      ['Distinct Product Sizes', numericValue(report.metrics?.distinctProductSizes), '#,##0'],
    ],
  ]

  summaryGrid.forEach((rowItems, index) => {
    const rowNum = 8 + index
    const [leftItem, rightItem] = rowItems

    summarySheet.getCell('A' + rowNum).value = leftItem[0]
    styleLabel(summarySheet.getCell('A' + rowNum))
    setNumber(summarySheet.getCell('B' + rowNum), leftItem[1], leftItem[2])

    summarySheet.getCell('D' + rowNum).value = rightItem[0]
    styleLabel(summarySheet.getCell('D' + rowNum))
    setNumber(summarySheet.getCell('E' + rowNum), rightItem[1], rightItem[2])

    for (const address of ['B' + rowNum, 'E' + rowNum]) {
      summarySheet.getCell(address).font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
      summarySheet.getCell(address).alignment = { vertical: 'middle', horizontal: 'right' }
      summarySheet.getCell(address).border = { bottom: THIN_RULE }
    }
  })

  summarySheet.mergeCells('A11:G11')
  summarySheet.getCell('A11').value = 'Breakdown by Product Specification'
  summarySheet.getCell('A11').font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
  summarySheet.getCell('A11').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  summarySheet.getCell('A11').border = { bottom: { style: 'thin', color: { argb: COLOR.ink } } }

  const specHeaderRow = summarySheet.getRow(12)
  specHeaderRow.values = ['Product Label', 'Size', 'Diameter (mm)', 'Radius (mm)', 'Circumference (mm)', 'Quantity (pcs)', '% of Total']
  styleTableHeader(specHeaderRow)

  const specBreakdown = Array.isArray(report.specBreakdown) ? report.specBreakdown : []
  if (specBreakdown.length === 0) {
    const emptyRow = summarySheet.getRow(13)
    summarySheet.mergeCells('A13:G13')
    emptyRow.getCell(1).value = 'No accepted pipe cutting events recorded for this period.'
    emptyRow.getCell(1).font = { name: 'Arial', size: 10, italic: true, color: { argb: COLOR.ink } }
    emptyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
    emptyRow.getCell(1).border = { bottom: THIN_RULE }
    emptyRow.height = 24
  } else {
    specBreakdown.forEach((group, index) => {
      const row = summarySheet.getRow(13 + index)
      const label = group.label || (group.isSpecified === false ? 'Unspecified / Pending Tag' : 'N/A')
      const size = group.size || 'N/A'
      const diameter = numericValue(group.diameter) ?? 'N/A'
      const radius = numericValue(group.radius) ?? 'N/A'
      const circumference = numericValue(group.circumference) ?? 'N/A'
      const count = numericValue(group.pipeCount) ?? 0
      const pct = numericValue(group.percentageOfTotal) !== null ? group.percentageOfTotal / 100 : 'N/A'

      row.values = [label, size, diameter, radius, circumference, count, pct]
      styleTableBody(row)

      for (const colIdx of [3, 4, 5, 6]) {
        row.getCell(colIdx).alignment = { vertical: 'middle', horizontal: 'right' }
        if (typeof row.getCell(colIdx).value === 'number') {
          row.getCell(colIdx).numFmt = colIdx === 6 ? '#,##0' : '#,##0.##'
        }
      }

      row.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' }
      if (typeof row.getCell(7).value === 'number') {
        row.getCell(7).numFmt = '0.0%'
      }
    })

    const totalRow = summarySheet.getRow(13 + specBreakdown.length)
    totalRow.values = [
      'TOTAL ACCEPTED OUTPUT',
      'All Pipe Sizes',
      '-',
      '-',
      '-',
      numericValue(report.totalProductionOutput) ?? 0,
      1.0,
    ]
    styleTableBody(totalRow)
    totalRow.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
    totalRow.getCell(2).font = { name: 'Arial', size: 10, italic: true, color: { argb: COLOR.ink } }
    totalRow.getCell(6).font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
    totalRow.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' }
    totalRow.getCell(6).numFmt = '#,##0'
    totalRow.getCell(7).font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
    totalRow.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' }
    totalRow.getCell(7).numFmt = '0.0%'
  }

  // Worksheet 2: Production Cut Logs
  const logsSheet = workbook.addWorksheet('Production Cut Logs', {
    properties: { defaultRowHeight: 20 },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })

  logsSheet.columns = [
    { width: 26 },
    { width: 16 },
    { width: 26 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
    { width: 16 },
  ]
  logsSheet.views = [{ state: 'frozen', ySplit: 5, topLeftCell: 'A6', activeCell: 'A6', showGridLines: false }]

  logsSheet.mergeCells('A2:H2')
  logsSheet.getCell('A2').value = 'PETRO HYDRO PIPE CORP.  |  Production Cut Logs (S-05)'
  logsSheet.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: COLOR.ink } }
  logsSheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' }
  logsSheet.getRow(2).height = 25

  logsSheet.mergeCells('A3:D3')
  logsSheet.getCell('A3').value = reportTypeLabel
  logsSheet.getCell('A3').font = { name: 'Arial', size: 14, bold: true, color: { argb: COLOR.ink } }
  logsSheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  logsSheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left' }

  logsSheet.mergeCells('E3:H3')
  logsSheet.getCell('E3').value = report.selectedDate || 'Undated'
  logsSheet.getCell('E3').font = { name: 'Arial', size: 12, bold: true, color: { argb: COLOR.ink } }
  logsSheet.getCell('E3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  logsSheet.getCell('E3').alignment = { vertical: 'middle', horizontal: 'right' }
  logsSheet.getRow(3).height = 28

  const logHeaderRow = logsSheet.getRow(5)
  logHeaderRow.values = ['Cut Timestamp (PST)', 'Event Ref', 'Product Label', 'Size', 'Diameter (mm)', 'Radius (mm)', 'Circumference (mm)', 'Tag Status']
  styleTableHeader(logHeaderRow)

  const productionLogs = Array.isArray(report.productionLogs) ? report.productionLogs : []
  if (productionLogs.length === 0) {
    const emptyRow = logsSheet.getRow(6)
    logsSheet.mergeCells('A6:H6')
    emptyRow.getCell(1).value = 'No individual pipe cuts registered for this period.'
    emptyRow.getCell(1).font = { name: 'Arial', size: 10, italic: true, color: { argb: COLOR.ink } }
    emptyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
    emptyRow.getCell(1).border = { bottom: THIN_RULE }
    emptyRow.height = 24
  } else {
    productionLogs.forEach((log, index) => {
      const row = logsSheet.getRow(6 + index)
      const recordedAt = formatManilaDate(log.recordedAt)
      const eventRef = log.deviceEventId ?? (log.id ? String(log.id).slice(0, 8) : 'N/A')
      const label = log.label || 'N/A'
      const size = log.size || 'N/A'
      const diameter = numericValue(log.diameter) ?? 'N/A'
      const radius = numericValue(log.radius) ?? 'N/A'
      const circumference = numericValue(log.circumference) ?? 'N/A'
      const tagStatus = log.isSpecified ? 'Specified' : 'Pending Tag'

      row.values = [recordedAt, eventRef, label, size, diameter, radius, circumference, tagStatus]
      styleTableBody(row)

      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' }
      for (const colIdx of [5, 6, 7]) {
        row.getCell(colIdx).alignment = { vertical: 'middle', horizontal: 'right' }
        if (typeof row.getCell(colIdx).value === 'number') {
          row.getCell(colIdx).numFmt = '#,##0.##'
        }
      }
      row.getCell(8).alignment = { vertical: 'middle', horizontal: 'center' }
    })
  }
}

async function renderRegularWorkbook(workbook, report) {
  workbook.creator = 'PetroHydroPipe Operations'
  workbook.subject = 'Production and downtime report'
  workbook.title = 'Operational Report'

  const sheet = workbook.addWorksheet('Operational Report', {
    properties: { defaultRowHeight: 20 },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })

  sheet.columns = [
    { width: 34 },
    { width: 30 },
    { width: 12 },
    { width: 18 },
    { width: 20 },
  ]
  sheet.views = [{ state: 'frozen', ySplit: 3, topLeftCell: 'A4', activeCell: 'A4', showGridLines: false }]

  sheet.mergeCells('A2:E2')
  sheet.getCell('A2').value = 'PETRO HYDRO PIPE CORP.  |  Operational Report'
  sheet.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: COLOR.ink } }
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(2).height = 25

  const productionSummary = report.summary?.find((item) => item.id === 'production')
  const machineLabel = String(productionSummary?.helper || '').replace(/^From\s+/, '')
  sheet.mergeCells('A3:C3')
  const reportTypeLabel = report.reportType
    ? String(report.reportType).charAt(0).toUpperCase() + String(report.reportType).slice(1) + ' report'
    : 'Production and downtime'
  sheet.getCell('A3').value = reportTypeLabel
  sheet.getCell('A3').font = { name: 'Arial', size: 18, bold: true, color: { argb: COLOR.ink } }
  sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  sheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.mergeCells('D3:E3')
  sheet.getCell('D3').value = machineLabel
  sheet.getCell('D3').font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
  sheet.getCell('D3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  sheet.getCell('D3').alignment = { vertical: 'middle', horizontal: 'right' }
  sheet.getRow(3).height = 34

  sheet.getCell('A4').value = 'Period'
  styleLabel(sheet.getCell('A4'))
  sheet.getCell('B4').value = dateValue(report.selectedDate) || report.selectedDate || 'N/A'
  if (sheet.getCell('B4').value instanceof Date) sheet.getCell('B4').numFmt = 'mmm d, yyyy'
  sheet.getCell('B4').alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getCell('C4').value = 'Observation'
  styleLabel(sheet.getCell('C4'))
  sheet.mergeCells('D4:E4')
  sheet.getCell('D4').value = report.periodState
    ? String(report.periodState).charAt(0).toUpperCase() + String(report.periodState).slice(1)
    : 'N/A'
  sheet.getCell('D4').font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
  sheet.getCell('D4').alignment = { vertical: 'middle', horizontal: 'left' }

  sheet.getCell('A5').value = 'Generated (UTC)'
  styleLabel(sheet.getCell('A5'))
  sheet.mergeCells('B5:C5')
  const generatedAt = typeof report.generatedAt === 'string' ? new Date(report.generatedAt) : null
  sheet.getCell('B5').value = generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : 'N/A'
  if (sheet.getCell('B5').value instanceof Date) sheet.getCell('B5').numFmt = 'mmm d, yyyy hh:mm AM/PM'
  sheet.getCell('B5').alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getCell('D5').value = 'Loss rate'
  styleLabel(sheet.getCell('D5'))
  setNumber(sheet.getCell('E5'), numericValue(report.lossEstimateBasis?.ratePiecesPerMinute) === null
    ? null
    : report.lossEstimateBasis.ratePiecesPerMinute * 60, '#,##0.# "pcs/hr"')
  sheet.getCell('E5').alignment = { vertical: 'middle', horizontal: 'right' }

  sheet.mergeCells('A7:E7')
  sheet.getCell('A7').value = 'Period Summary'
  sheet.getCell('A7').font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
  sheet.getCell('A7').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  sheet.getCell('A7').border = { bottom: { style: 'thin', color: { argb: COLOR.ink } } }

  const processSensors = Array.isArray(report.processSensors) ? report.processSensors : []
  const processEvents = processSensors.length > 0 && processSensors.every((sensor) => numericValue(sensor.eventCount) !== null)
    ? processSensors.reduce((total, sensor) => total + sensor.eventCount, 0)
    : null
  const summaryRows = [
    [
      ['Production count', numericValue(report.metrics?.outputPieces), '#,##0 "pcs"'],
      ['Process sensor events', processEvents, '#,##0'],
    ],
    [
      ['Downtime events', summaryNumber(report, 'events'), '#,##0'],
      ['Downtime duration', numericValue(report.metrics?.durationMinutes), '#,##0.## "min"'],
    ],
    [
      ['Availability', numericValue(report.metrics?.availabilityPercent) === null ? null : report.metrics.availabilityPercent / 100, '0.0%'],
      ['Estimated loss', numericValue(report.metrics?.estimatedLoss), '#,##0.## "pcs"'],
    ],
  ]

  summaryRows.forEach((items, index) => {
    const rowNumber = 8 + index
    const [leftItem, rightItem] = items
    sheet.getCell('A' + rowNumber).value = leftItem[0]
    styleLabel(sheet.getCell('A' + rowNumber))
    setNumber(sheet.getCell('B' + rowNumber), leftItem[1], leftItem[2])
    sheet.getCell('D' + rowNumber).value = rightItem[0]
    styleLabel(sheet.getCell('D' + rowNumber))
    setNumber(sheet.getCell('E' + rowNumber), rightItem[1], rightItem[2])
    for (const address of ['B' + rowNumber, 'E' + rowNumber]) {
      sheet.getCell(address).font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
      sheet.getCell(address).alignment = { vertical: 'middle', horizontal: 'right' }
      sheet.getCell(address).border = { bottom: THIN_RULE }
    }
  })

  sheet.mergeCells('A12:E12')
  sheet.getCell('A12').value = 'Process Sensor Activity'
  sheet.getCell('A12').font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
  sheet.getCell('A12').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  sheet.getCell('A12').border = { bottom: { style: 'thin', color: { argb: COLOR.ink } } }
  sheet.getRow(13).values = ['Code', 'Sensor', 'Events', null, null]
  sheet.mergeCells('C13:E13')
  styleTableHeader(sheet.getRow(13))

  processSensors.forEach((sensor, index) => {
    const row = sheet.getRow(14 + index)
    row.values = [sensor.sensorCode || 'N/A', sensor.sensorLabel || 'N/A', numericValue(sensor.eventCount) ?? 'N/A']
    sheet.mergeCells('C' + row.number + ':E' + row.number)
    styleTableBody(row)
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' }
    if (typeof row.getCell(3).value === 'number') row.getCell(3).numFmt = '#,##0'
  })

  const downtimeSectionRow = Math.max(18, 15 + processSensors.length)
  sheet.mergeCells('A' + downtimeSectionRow + ':E' + downtimeSectionRow)
  sheet.getCell('A' + downtimeSectionRow).value = 'Downtime Records'
  sheet.getCell('A' + downtimeSectionRow).font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.ink } }
  sheet.getCell('A' + downtimeSectionRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  sheet.getCell('A' + downtimeSectionRow).border = { bottom: { style: 'thin', color: { argb: COLOR.ink } } }

  const headerRowNumber = downtimeSectionRow + 1
  const headerRow = sheet.getRow(headerRowNumber)
  headerRow.values = ['Cause', 'Sensor', 'Events', 'Duration (min)', 'Estimated loss (pcs)']
  styleTableHeader(headerRow)

  const downtimeRows = Array.isArray(report.rows) ? report.rows : []
  if (downtimeRows.length === 0) {
    const emptyRow = sheet.getRow(headerRowNumber + 1)
    sheet.mergeCells('A' + emptyRow.number + ':E' + emptyRow.number)
    emptyRow.getCell(1).value = 'No downtime records for this period.'
    emptyRow.getCell(1).font = { name: 'Arial', size: 10, italic: true, color: { argb: COLOR.ink } }
    emptyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
    emptyRow.getCell(1).border = { bottom: THIN_RULE }
    emptyRow.height = 24
  } else {
    downtimeRows.forEach((item, index) => {
      const row = sheet.getRow(headerRowNumber + 1 + index)
      row.values = [item.cause || 'N/A', item.sensor || 'N/A', numericValue(item.events) ?? 'N/A', numericValue(item.durationMinutes) ?? 'N/A', numericValue(item.estimatedLoss) ?? 'N/A']
      styleTableBody(row)
      for (const column of [3, 4, 5]) {
        row.getCell(column).alignment = { vertical: 'middle', horizontal: 'right' }
        if (typeof row.getCell(column).value === 'number') {
          const numberFormat = column === 3 ? '#,##0' : '#,##0.##'
          row.getCell(column).numFmt = numberFormatFor(row.getCell(column).value, numberFormat)
        }
      }
    })
  }
}

async function toXlsx(report) {
  const workbook = new ExcelJS.Workbook()

  if (report.category === 'production') {
    await renderProductionWorkbook(workbook, report)
  } else {
    await renderRegularWorkbook(workbook, report)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

module.exports = { toXlsx }
