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

function setNumber(cell, value, numberFormat) {
  cell.value = numericValue(value) ?? 'N/A'
  if (typeof cell.value === 'number') cell.numFmt = numberFormatFor(cell.value, numberFormat)
}

function styleLabel(cell) {
  cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: COLOR.ink } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rule } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
}

async function toXlsx(report) {
  const workbook = new ExcelJS.Workbook()
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

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
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

module.exports = { toXlsx }
