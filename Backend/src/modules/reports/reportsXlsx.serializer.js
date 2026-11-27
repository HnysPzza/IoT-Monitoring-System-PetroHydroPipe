const ExcelJS = require('@excel.js/exceljs').default
const {
  OUTPUT_SENSOR_CODE,
  PROCESS_SENSOR_CODES,
  getSensorLabel,
} = require('../../shared/sensorIdentity')

const COMPANY_NAME = 'Petro Hydro Pipes Corporation'
const FONT_FAMILY = 'Arial'
const MISSING_PLACEHOLDER = '—'

const COLOR = {
  primary: 'FF0F172A',
  body: 'FF1E293B',
  muted: 'FF475569',
  subtle: 'FF64748B',
  surface: 'FFF8FAFC',
  rule: 'FFCBD5E1',
  hairline: 'FFE2E8F0',
  accent: 'FF1E3A8A',
  paper: 'FFFFFFFF',
}

const BORDER = {
  mastheadBottom: { bottom: { style: 'medium', color: { argb: COLOR.accent } } },
  sectionBottom: { bottom: { style: 'thin', color: { argb: COLOR.rule } } },
  headerBox: {
    top: { style: 'thin', color: { argb: COLOR.rule } },
    bottom: { style: 'thin', color: { argb: COLOR.rule } },
  },
  bodyBottom: { bottom: { style: 'thin', color: { argb: COLOR.hairline } } },
  totalBox: {
    top: { style: 'thin', color: { argb: COLOR.primary } },
    bottom: { style: 'double', color: { argb: COLOR.rule } },
  },
}

const PCT_UNIT_FMT = '[=1]#,##0 "pc";#,##0 "pcs"'

function numericValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function escapeFormula(value) {
  if (typeof value === 'string' && /^[\t\r\n ]*[=+@-]/.test(value)) {
    return `'${value}`
  }
  return value
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

function capitalizeWord(value, fallback) {
  if (!value) return fallback
  const str = String(value).trim()
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : fallback
}

const MANILA_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const MANILA_DATE_TEXT_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const SHORT_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function getManilaParts(dateInput) {
  const d = new Date(dateInput)
  if (Number.isNaN(d.getTime())) return null
  const parts = MANILA_PARTS_FORMATTER.formatToParts(d)
  const map = {}
  for (let i = 0; i < parts.length; i += 1) {
    map[parts[i].type] = parts[i].value
  }
  return map
}

function manilaExcelDate(dateInput) {
  if (!dateInput) return null
  const parts = getManilaParts(dateInput)
  if (!parts) return null
  // Excel date serials lack timezone metadata, so store Manila wall clock in UTC fields.
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ))
}

function formatManilaDayKey(dateStr, fallbackDate = null) {
  if (!dateStr) return fallbackDate
  const parts = getManilaParts(dateStr)
  if (!parts) return fallbackDate
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatManilaDateText(dateInput) {
  if (!dateInput) return MISSING_PLACEHOLDER
  const d = new Date(dateInput)
  if (Number.isNaN(d.getTime())) return String(dateInput)
  return `${MANILA_DATE_TEXT_FORMATTER.format(d)} PST`
}

function formatShortDay(dayKey) {
  const d = dateValue(dayKey)
  if (!d) return dayKey ? String(dayKey) : 'Undated'
  return SHORT_DAY_FORMATTER.format(d)
}

function formatPeriodWindowLabel(report) {
  if (report.observedStartAt && report.observedEndAt) {
    const startKey = formatManilaDayKey(report.observedStartAt)
    const endMs = Date.parse(report.observedEndAt)
    const endKey = Number.isFinite(endMs)
      ? formatManilaDayKey(new Date(endMs - 1).toISOString())
      : null
    if (startKey && endKey && startKey !== endKey) {
      return `${formatShortDay(startKey)} - ${formatShortDay(endKey)}`
    }
    if (startKey) return formatShortDay(startKey)
  }
  return report.selectedDate ? formatShortDay(report.selectedDate) : 'Undated'
}

function buildDocRef(report) {
  const prefix = report.category === 'production' ? 'PHP-PROD' : 'PHP-RPT'
  const typeToken = String(report.reportType || 'DAILY').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DAILY'
  const dateToken = String(report.selectedDate || 'UNDATED').replace(/[^A-Za-z0-9]/g, '') || 'UNDATED'
  return `${prefix}-${typeToken}-${dateToken}`
}

function formatHeaderFooterText(value) {
  return String(value || '').replaceAll('&', '&&')
}

function estimateRowHeight(cellSpecs, fontSize, minHeight = 22, isBold = false) {
  const lineHeight = Math.round(fontSize * 1.4)
  const scaleFactor = isBold ? 0.84 : 0.94
  let maxLines = 1

  for (const { text, width } of cellSpecs) {
    if (text === null || text === undefined || text === '') continue
    const effectiveChars = Math.max(6, Math.floor(((width || 14) - 2) * (10 / fontSize) * scaleFactor))
    let lines = 0
    for (const paragraph of String(text).split(/\r?\n/)) {
      lines += Math.max(1, Math.ceil(paragraph.length / effectiveChars))
    }
    if (lines > maxLines) maxLines = lines
  }

  return Math.max(minHeight, (maxLines * lineHeight) + 8)
}

function applySheetPageSetup(sheet, { printTitlesRow, machineLabel }) {
  const safeMachine = machineLabel || 'Spiral Mill 01'
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.45, bottom: 0.5, header: 0.25, footer: 0.25 },
    ...(printTitlesRow ? { printTitlesRow } : {}),
  }
  sheet.headerFooter = {
    oddFooter: `&L&"${FONT_FAMILY}"&8&K64748B${formatHeaderFooterText(COMPANY_NAME)} · ${formatHeaderFooterText(safeMachine)}&R&"${FONT_FAMILY}"&8&K64748BPage &P of &N`,
  }
}

function setFormula(cell, formula, result, numberFormat) {
  cell.value = { formula, result }
  if (numberFormat) cell.numFmt = numberFormat
}

function setMissing(cell, horizontal = 'right') {
  cell.value = MISSING_PLACEHOLDER
  cell.font = { name: FONT_FAMILY, size: 10, color: { argb: COLOR.subtle } }
  cell.alignment = { vertical: 'middle', horizontal }
}

function setTypedNumber(cell, value, numberFormat, font, fixed = false) {
  const num = numericValue(value)
  if (num === null) {
    setMissing(cell, 'right')
    return false
  }
  cell.value = num
  cell.numFmt = fixed ? numberFormat : numberFormatFor(num, numberFormat)
  if (font) cell.font = font
  return true
}

function styleNumericCells(row, specs, font) {
  for (const [colIdx, val, fmt, fixed = false] of specs) {
    const cell = row.getCell(colIdx)
    cell.alignment = { vertical: 'middle', horizontal: 'right' }
    setTypedNumber(cell, val, fmt, font, fixed)
  }
}

function applyRowBorder(row, colCount, border) {
  for (let col = 1; col <= colCount; col += 1) {
    row.getCell(col).border = border
  }
}

function renderMasthead(sheet, { colCount, splitCol, title, docRef, metaLeft, metaRight }) {
  const lastColLetter = sheet.getColumn(colCount).letter
  const leftEndLetter = sheet.getColumn(splitCol).letter
  const rightStartLetter = sheet.getColumn(splitCol + 1).letter
  const leftWidth = sheet.columns.slice(0, splitCol).reduce((sum, col) => sum + (col.width || 12), 0)
  const rightWidth = sheet.columns.slice(splitCol, colCount).reduce((sum, col) => sum + (col.width || 12), 0)

  sheet.mergeCells(`A1:${leftEndLetter}1`)
  const titleCell = sheet.getCell('A1')
  titleCell.value = escapeFormula(title)
  titleCell.font = { name: FONT_FAMILY, size: 14, bold: true, color: { argb: COLOR.primary } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }

  sheet.mergeCells(`${rightStartLetter}1:${lastColLetter}1`)
  const refCell = sheet.getCell(`${rightStartLetter}1`)
  refCell.value = escapeFormula(docRef)
  refCell.font = { name: FONT_FAMILY, size: 8.5, bold: true, color: { argb: COLOR.subtle } }
  refCell.alignment = { vertical: 'middle', horizontal: 'right' }
  sheet.getRow(1).height = 26

  sheet.mergeCells(`A2:${leftEndLetter}2`)
  const safeMetaLeft = escapeFormula(metaLeft)
  const leftMetaCell = sheet.getCell('A2')
  leftMetaCell.value = safeMetaLeft
  leftMetaCell.font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLOR.muted } }
  leftMetaCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

  sheet.mergeCells(`${rightStartLetter}2:${lastColLetter}2`)
  const safeMetaRight = escapeFormula(metaRight)
  const rightMetaCell = sheet.getCell(`${rightStartLetter}2`)
  rightMetaCell.value = safeMetaRight
  rightMetaCell.font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLOR.muted } }
  rightMetaCell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true }
  sheet.getRow(2).height = estimateRowHeight([
    { text: safeMetaLeft, width: leftWidth },
    { text: safeMetaRight, width: rightWidth },
  ], 9.5, 20, false)

  for (let col = 1; col <= colCount; col += 1) {
    sheet.getRow(2).getCell(col).border = BORDER.mastheadBottom
  }

  sheet.getRow(3).height = 10
}

function renderKpiStrip(sheet, labelRowNum, items, colWidths) {
  const valueRowNum = labelRowNum + 1
  const labelRow = sheet.getRow(labelRowNum)
  const valueRow = sheet.getRow(valueRowNum)

  labelRow.height = estimateRowHeight(
    items.map((item, idx) => ({ text: item.label, width: colWidths[idx] })),
    8.5,
    20,
    true,
  )
  valueRow.height = 26

  items.forEach((item, idx) => {
    const colIdx = idx + 1
    const align = item.align || 'right'
    const labelCell = labelRow.getCell(colIdx)
    const valueCell = valueRow.getCell(colIdx)
    const sideDivider = idx < items.length - 1
      ? { right: { style: 'thin', color: { argb: COLOR.hairline } } }
      : {}

    labelCell.value = item.label
    labelCell.font = { name: FONT_FAMILY, size: 8.5, bold: true, color: { argb: COLOR.muted } }
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.surface } }
    labelCell.alignment = { vertical: 'middle', horizontal: align, wrapText: true }
    labelCell.border = { top: { style: 'thin', color: { argb: COLOR.rule } }, ...sideDivider }

    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.surface } }
    valueCell.border = { bottom: { style: 'thin', color: { argb: COLOR.rule } }, ...sideDivider }

    if (item.formula) {
      if (item.result === null) {
        setMissing(valueCell, align)
      } else {
        setFormula(valueCell, item.formula, item.result, item.numFmt)
        valueCell.font = { name: FONT_FAMILY, size: item.fontSize || 14, bold: true, color: { argb: item.color || COLOR.primary } }
        valueCell.alignment = { vertical: 'middle', horizontal: align }
      }
      return
    }

    if (item.kind === 'text') {
      if (!item.value) {
        setMissing(valueCell, align)
      } else {
        valueCell.value = escapeFormula(item.value)
        valueCell.font = { name: FONT_FAMILY, size: item.fontSize || 11, bold: true, color: { argb: item.color || COLOR.primary } }
        valueCell.alignment = { vertical: 'middle', horizontal: align }
      }
      return
    }

    const num = numericValue(item.value)
    if (num === null) {
      setMissing(valueCell, align)
    } else {
      valueCell.value = num
      valueCell.numFmt = item.exactFmt ? item.numFmt : numberFormatFor(num, item.numFmt || '#,##0')
      valueCell.font = { name: FONT_FAMILY, size: item.fontSize || 14, bold: true, color: { argb: item.color || COLOR.primary } }
      valueCell.alignment = { vertical: 'middle', horizontal: align }
    }
  })
}

function renderSectionTitle(sheet, rowNumber, colCount, title) {
  const endLetter = sheet.getColumn(colCount).letter
  sheet.mergeCells(`A${rowNumber}:${endLetter}${rowNumber}`)
  const row = sheet.getRow(rowNumber)
  row.height = 22
  const cell = row.getCell(1)
  cell.value = title
  cell.font = { name: FONT_FAMILY, size: 10.5, bold: true, color: { argb: COLOR.primary } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
  for (let col = 1; col <= colCount; col += 1) {
    row.getCell(col).border = BORDER.sectionBottom
  }
}

function styleHeaderRow(sheet, rowNumber, columns, colWidths) {
  const row = sheet.getRow(rowNumber)
  row.values = columns.map((col) => col.label)
  row.height = estimateRowHeight(
    columns.map((col, idx) => ({ text: col.label, width: colWidths[idx] })),
    9,
    26,
    true,
  )
  columns.forEach((col, idx) => {
    const cell = row.getCell(idx + 1)
    cell.font = { name: FONT_FAMILY, size: 9, bold: true, color: { argb: COLOR.muted } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.surface } }
    cell.alignment = { vertical: 'middle', horizontal: col.align || 'left', wrapText: true }
    cell.border = BORDER.headerBox
  })
}

function styleEmptyNoticeRow(sheet, rowNumber, colCount, message) {
  const row = sheet.getRow(rowNumber)
  const endLetter = sheet.getColumn(colCount).letter
  sheet.mergeCells(`A${rowNumber}:${endLetter}${rowNumber}`)
  row.height = 24
  const cell = row.getCell(1)
  cell.value = message
  cell.font = { name: FONT_FAMILY, size: 9.5, italic: true, color: { argb: COLOR.subtle } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
  for (let col = 1; col <= colCount; col += 1) {
    row.getCell(col).border = BORDER.bodyBottom
  }
}

function styleTotalRow(sheet, rowNumber, colCount, cellsByCol) {
  const row = sheet.getRow(rowNumber)
  row.height = 23

  for (let col = 1; col <= colCount; col += 1) {
    const cell = row.getCell(col)
    cell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR.primary } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.surface } }
    cell.border = BORDER.totalBox
    cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' }
  }

  for (const [colIdx, spec] of Object.entries(cellsByCol)) {
    const cell = row.getCell(Number(colIdx))
    if (spec.formula) {
      setFormula(cell, spec.formula, spec.result, spec.numFmt)
    } else {
      cell.value = spec.value
      if (spec.numFmt) cell.numFmt = spec.numFmt
    }
    if (spec.align) cell.alignment = { vertical: 'middle', horizontal: spec.align }
  }
}

function renderFootnote(sheet, rowNumber, colCount, text) {
  const endLetter = sheet.getColumn(colCount).letter
  sheet.mergeCells(`A${rowNumber}:${endLetter}${rowNumber}`)
  const row = sheet.getRow(rowNumber)
  const safeText = escapeFormula(text)
  const spanWidth = sheet.columns.slice(0, colCount).reduce((sum, col) => sum + (col.width || 12), 0)
  row.height = estimateRowHeight([{ text: safeText, width: spanWidth }], 8.5, 18, false)
  const cell = row.getCell(1)
  cell.value = safeText
  cell.font = { name: FONT_FAMILY, size: 8.5, color: { argb: COLOR.subtle } }
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
}

function collectDatedDailyStats(productionLogs) {
  const dayStats = new Map()
  let undatedCount = 0

  for (const log of productionLogs) {
    const dayKey = formatManilaDayKey(log.recordedAt, null)
    const parsedDay = dayKey ? dateValue(dayKey) : null
    if (!parsedDay) {
      undatedCount += 1
      continue
    }
    const existing = dayStats.get(dayKey) || { dayKey, date: parsedDay, count: 0, tons: 0 }
    existing.count += 1
    const tonVal = numericValue(log.tonnage)
    if (tonVal !== null && tonVal > 0) existing.tons += tonVal
    dayStats.set(dayKey, existing)
  }

  const days = Array.from(dayStats.values())
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map((entry) => ({ ...entry, tons: Math.round(entry.tons * 10000) / 10000 }))

  return { days, undatedCount }
}

function renderProductionSummarySheet(workbook, report, { machineLabel, sensorLabel, reportTypeLabel, periodWindow, generatedText, docRef }) {
  const colWidths = [32, 18, 15, 15, 15, 17, 15]
  const sheet = workbook.addWorksheet('Production Summary', {
    properties: { defaultRowHeight: 20 },
  })
  sheet.columns = colWidths.map((width) => ({ width }))
  sheet.views = [{ showGridLines: false }]
  applySheetPageSetup(sheet, { machineLabel })

  const observation = capitalizeWord(report.periodState, MISSING_PLACEHOLDER)
  renderMasthead(sheet, {
    colCount: 7,
    splitCol: 4,
    title: `${COMPANY_NAME}  ·  Production Output Report`,
    docRef,
    metaLeft: `${reportTypeLabel}  ·  ${machineLabel}  ·  ${periodWindow}`,
    metaRight: `Station: ${sensorLabel}\nGenerated ${generatedText}`,
  })

  const totalOut = numericValue(report.metrics?.totalProductionOutput)
  const specPipes = numericValue(report.metrics?.specifiedPipes)
  const unspecPipes = numericValue(report.metrics?.unspecifiedPipes)
  const totalTons = numericValue(report.metrics?.totalTonnage ?? report.totalTonnage)
  const distinctSizes = numericValue(report.metrics?.distinctProductSizes)
  const coverageResult = totalOut !== null && specPipes !== null
    ? (totalOut > 0 ? specPipes / totalOut : 0)
    : null

  renderKpiStrip(sheet, 4, [
    { label: 'TOTAL OUTPUT', value: totalOut, numFmt: PCT_UNIT_FMT, exactFmt: true, align: 'left' },
    { label: 'TOTAL TONNAGE (tons)', value: totalTons, numFmt: '#,##0.0000', exactFmt: true, align: 'right' },
    { label: 'SPECIFIED', value: specPipes, numFmt: PCT_UNIT_FMT, exactFmt: true, align: 'right' },
    { label: 'UNSPECIFIED', value: unspecPipes, numFmt: PCT_UNIT_FMT, exactFmt: true, align: 'right' },
    { label: 'TAG COVERAGE', formula: 'IF(A5>0,C5/A5,0)', result: coverageResult, numFmt: '0.0%', align: 'right' },
    { label: 'DISTINCT SPECS', value: distinctSizes, numFmt: '#,##0', align: 'right' },
    { label: 'OBSERVATION', kind: 'text', value: observation === MISSING_PLACEHOLDER ? null : observation, align: 'right', fontSize: 12, color: COLOR.accent },
  ], colWidths)

  sheet.getRow(6).height = 12

  renderSectionTitle(sheet, 7, 7, 'Breakdown by Product Specification')
  styleHeaderRow(sheet, 8, [
    { label: 'Customer', align: 'left' },
    { label: 'Diameter (OD) mm', align: 'right' },
    { label: 'Thickness mm', align: 'right' },
    { label: 'Length mm', align: 'right' },
    { label: 'Quantity (pcs)', align: 'right' },
    { label: 'Total Tons', align: 'right' },
    { label: '% of Total', align: 'right' },
  ], colWidths)

  const specBreakdown = Array.isArray(report.specBreakdown) ? report.specBreakdown : []
  let nextRow = 9

  if (specBreakdown.length === 0) {
    styleEmptyNoticeRow(sheet, nextRow, 7, 'No accepted pipe cutting events recorded for this period.')
    nextRow += 1
  } else {
    const firstSpecRow = 9
    const lastSpecRow = firstSpecRow + specBreakdown.length - 1
    const totalSpecRow = lastSpecRow + 1
    const breakdownQtySum = specBreakdown.reduce((sum, g) => sum + (numericValue(g.pipeCount) ?? 0), 0)
    const breakdownTonsSum = Math.round(
      specBreakdown.reduce((sum, g) => sum + (numericValue(g.totalTonnage) ?? 0), 0) * 10000,
    ) / 10000

    sheet.autoFilter = `A8:G${lastSpecRow}`

    specBreakdown.forEach((group, idx) => {
      const row = sheet.getRow(firstSpecRow + idx)
      const customerText = escapeFormula(
        group.customer || (group.isSpecified === false ? 'Unspecified / Pending Tag' : (group.label || MISSING_PLACEHOLDER)),
      )
      const bodyFont = { name: FONT_FAMILY, size: 9.5, color: { argb: COLOR.body } }

      row.getCell(1).value = customerText
      row.getCell(1).font = bodyFont
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

      styleNumericCells(row, [
        [2, group.diameter, '#,##0.00', true],
        [3, group.thickness, '#,##0.00', true],
        [4, group.length, '#,##0.##', false],
      ], bodyFont)

      const qtyVal = numericValue(group.pipeCount) ?? 0
      const qtyCell = row.getCell(5)
      qtyCell.value = qtyVal
      qtyCell.numFmt = '#,##0'
      qtyCell.font = bodyFont
      qtyCell.alignment = { vertical: 'middle', horizontal: 'right' }

      styleNumericCells(row, [[6, group.totalTonnage, '#,##0.0000', true]], bodyFont)

      const pctCell = row.getCell(7)
      pctCell.alignment = { vertical: 'middle', horizontal: 'right' }
      const pctFallback = numericValue(group.percentageOfTotal) !== null
        ? group.percentageOfTotal / 100
        : (breakdownQtySum > 0 ? qtyVal / breakdownQtySum : 0)
      const pctResult = breakdownQtySum > 0 ? qtyVal / breakdownQtySum : pctFallback
      setFormula(pctCell, `IF($E$${totalSpecRow}>0,E${row.number}/$E$${totalSpecRow},0)`, pctResult, '0.0%')
      pctCell.font = bodyFont

      applyRowBorder(row, 7, BORDER.bodyBottom)
      row.height = estimateRowHeight([{ text: customerText, width: colWidths[0] }], 9.5, 22, false)
    })

    const totalPctResult = specBreakdown.length > 0 && breakdownQtySum > 0 ? 1 : 0
    styleTotalRow(sheet, totalSpecRow, 7, {
      1: { value: 'TOTAL ACCEPTED OUTPUT', align: 'left' },
      5: { formula: `SUM(E${firstSpecRow}:E${lastSpecRow})`, result: breakdownQtySum, numFmt: '#,##0' },
      6: { formula: `SUM(F${firstSpecRow}:F${lastSpecRow})`, result: breakdownTonsSum, numFmt: '#,##0.0000' },
      7: { formula: `SUM(G${firstSpecRow}:G${lastSpecRow})`, result: totalPctResult, numFmt: '0.0%' },
    })
    nextRow = totalSpecRow + 1
  }

  const productionLogs = Array.isArray(report.productionLogs) ? report.productionLogs : []
  const { days: dailyStats, undatedCount } = collectDatedDailyStats(productionLogs)

  if (dailyStats.length > 0 && productionLogs.length > 0) {
    const lastLogRow = 4 + productionLogs.length
    sheet.getRow(nextRow).height = 12
    const titleRow = nextRow + 1
    renderSectionTitle(sheet, titleRow, 4, 'Daily Production Rollup (Manila PST)')
    const dailyHeaderRow = titleRow + 1
    styleHeaderRow(sheet, dailyHeaderRow, [
      { label: 'Date (PST)', align: 'left' },
      { label: 'Cut Count', align: 'right' },
      { label: 'Total Tons', align: 'right' },
      { label: '% of Logged Tons', align: 'right' },
    ], colWidths)

    const firstDailyRow = dailyHeaderRow + 1
    const lastDailyRow = firstDailyRow + dailyStats.length - 1
    const totalDailyRow = lastDailyRow + 1
    const loggedTotalCuts = dailyStats.reduce((sum, d) => sum + d.count, 0)
    const loggedTotalTons = Math.round(dailyStats.reduce((sum, d) => sum + d.tons, 0) * 10000) / 10000
    const logRangeDate = `'Production Cut Logs'!$A$5:$A$${lastLogRow}`
    const logRangeTons = `'Production Cut Logs'!$G$5:$G$${lastLogRow}`

    dailyStats.forEach((day, idx) => {
      const rowNum = firstDailyRow + idx
      const row = sheet.getRow(rowNum)
      row.height = 22
      const bodyFont = { name: FONT_FAMILY, size: 9.5, color: { argb: COLOR.body } }

      const dateCell = row.getCell(1)
      dateCell.value = day.date
      dateCell.numFmt = 'mmm d, yyyy'
      dateCell.font = bodyFont
      dateCell.alignment = { vertical: 'middle', horizontal: 'left' }

      const countCell = row.getCell(2)
      setFormula(
        countCell,
        `COUNTIFS(${logRangeDate},">="&A${rowNum},${logRangeDate},"<"&(A${rowNum}+1))`,
        day.count,
        PCT_UNIT_FMT,
      )
      countCell.font = bodyFont
      countCell.alignment = { vertical: 'middle', horizontal: 'right' }

      const tonsCell = row.getCell(3)
      setFormula(
        tonsCell,
        `SUMIFS(${logRangeTons},${logRangeDate},">="&A${rowNum},${logRangeDate},"<"&(A${rowNum}+1))`,
        day.tons,
        '#,##0.0000',
      )
      tonsCell.font = bodyFont
      tonsCell.alignment = { vertical: 'middle', horizontal: 'right' }

      const shareCell = row.getCell(4)
      setFormula(
        shareCell,
        `IF($C$${totalDailyRow}>0,C${rowNum}/$C$${totalDailyRow},0)`,
        loggedTotalTons > 0 ? day.tons / loggedTotalTons : 0,
        '0.0%',
      )
      shareCell.font = bodyFont
      shareCell.alignment = { vertical: 'middle', horizontal: 'right' }

      applyRowBorder(row, 4, BORDER.bodyBottom)
    })

    styleTotalRow(sheet, totalDailyRow, 4, {
      1: { value: 'TOTAL LOGGED CUTS', align: 'left' },
      2: { formula: `SUM(B${firstDailyRow}:B${lastDailyRow})`, result: loggedTotalCuts, numFmt: PCT_UNIT_FMT },
      3: { formula: `SUM(C${firstDailyRow}:C${lastDailyRow})`, result: loggedTotalTons, numFmt: '#,##0.0000' },
      4: { formula: `SUM(D${firstDailyRow}:D${lastDailyRow})`, result: loggedTotalTons > 0 ? 1 : 0, numFmt: '0.0%' },
    })
    nextRow = totalDailyRow + 1
    if (undatedCount > 0) {
      sheet.getRow(nextRow).height = 8
      renderFootnote(
        sheet,
        nextRow + 1,
        7,
        `Source: ${sensorLabel} · Observation: ${observation} · ${undatedCount} cut(s) without valid timestamp excluded from daily rollup.`,
      )
      return
    }
  }

  sheet.getRow(nextRow).height = 8
  const capNote = totalOut !== null && productionLogs.length > 0 && productionLogs.length < totalOut
    ? `Cut Logs tab displays ${productionLogs.length} of ${totalOut} total cuts.`
    : 'Cut Logs tab contains individual sortable pipe cuts.'
  renderFootnote(sheet, nextRow + 1, 7, `Source: ${sensorLabel} · Observation: ${observation} · ${capNote}`)
}

function renderProductionCutLogsSheet(workbook, report, { machineLabel, reportTypeLabel, periodWindow, docRef }) {
  const colWidths = [24, 30, 14, 13, 13, 12, 14, 14]
  const sheet = workbook.addWorksheet('Production Cut Logs', {
    properties: { defaultRowHeight: 20 },
  })
  sheet.columns = colWidths.map((width) => ({ width }))
  applySheetPageSetup(sheet, { printTitlesRow: '4:4', machineLabel })

  const productionLogs = Array.isArray(report.productionLogs) ? report.productionLogs : []
  const totalOut = numericValue(report.metrics?.totalProductionOutput ?? report.totalProductionOutput)
  const observation = capitalizeWord(report.periodState, MISSING_PLACEHOLDER)
  const countNotice = totalOut !== null && productionLogs.length < totalOut
    ? `Showing ${productionLogs.length} of ${totalOut} cuts`
    : 'All times Manila (PST)'

  renderMasthead(sheet, {
    colCount: 8,
    splitCol: 4,
    title: `${COMPANY_NAME}  ·  Production Cut Logs (${OUTPUT_SENSOR_CODE})`,
    docRef,
    metaLeft: `${reportTypeLabel}  ·  ${machineLabel}  ·  ${periodWindow}`,
    metaRight: `Observation: ${observation}  ·  ${countNotice}`,
  })

  styleHeaderRow(sheet, 4, [
    { label: 'Cut Timestamp (PST)', align: 'left' },
    { label: 'Customer', align: 'left' },
    { label: 'Diameter (OD) mm', align: 'right' },
    { label: 'Thickness mm', align: 'right' },
    { label: 'Length mm', align: 'right' },
    { label: 'Pipe #', align: 'center' },
    { label: 'Tons', align: 'right' },
    { label: 'Status', align: 'center' },
  ], colWidths)

  if (productionLogs.length === 0) {
    sheet.views = [{ state: 'frozen', ySplit: 4, topLeftCell: 'A5', activeCell: 'A5', showGridLines: false }]
    styleEmptyNoticeRow(sheet, 5, 8, 'No individual pipe cuts registered for this period.')
    return
  }

  sheet.views = [{ state: 'frozen', ySplit: 4, topLeftCell: 'A5', activeCell: 'A5', showGridLines: false }]
  const firstLogRow = 5
  const lastLogRow = firstLogRow + productionLogs.length - 1
  sheet.autoFilter = `A4:H${lastLogRow}`

  let totalLogTons = 0
  const bodyFont = { name: FONT_FAMILY, size: 9.5, color: { argb: COLOR.body } }

  productionLogs.forEach((log, idx) => {
    const rowNum = firstLogRow + idx
    const row = sheet.getRow(rowNum)

    const tsCell = row.getCell(1)
    const excelDate = manilaExcelDate(log.recordedAt)
    tsCell.alignment = { vertical: 'middle', horizontal: 'left' }
    if (excelDate) {
      tsCell.value = excelDate
      tsCell.numFmt = 'mmm d, yyyy hh:mm AM/PM'
      tsCell.font = bodyFont
    } else if (log.recordedAt) {
      tsCell.value = escapeFormula(String(log.recordedAt))
      tsCell.font = bodyFont
    } else {
      setMissing(tsCell, 'left')
    }

    const customerText = escapeFormula(
      log.customer || (log.isSpecified ? (log.label || MISSING_PLACEHOLDER) : 'Pending Tag'),
    )
    const customerCell = row.getCell(2)
    customerCell.value = customerText
    customerCell.font = log.isSpecified
      ? bodyFont
      : { name: FONT_FAMILY, size: 9.5, italic: true, color: { argb: COLOR.subtle } }
    customerCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

    styleNumericCells(row, [
      [3, log.diameter, '#,##0.00', true],
      [4, log.thickness, '#,##0.00', true],
      [5, log.length, '#,##0.##', false],
    ], bodyFont)

    const pipeCell = row.getCell(6)
    pipeCell.alignment = { vertical: 'middle', horizontal: 'center' }
    const parsedPipeNumber = log.pipeNumber !== null &&
      log.pipeNumber !== undefined &&
      typeof log.pipeNumber !== 'boolean' &&
      String(log.pipeNumber).trim() !== ''
      ? Number(log.pipeNumber)
      : NaN
    if (Number.isFinite(parsedPipeNumber)) {
      pipeCell.value = parsedPipeNumber
      pipeCell.numFmt = '#,##0'
      pipeCell.font = bodyFont
    } else if (typeof log.deviceEventId === 'string') {
      pipeCell.value = escapeFormula(log.deviceEventId)
      pipeCell.font = bodyFont
    } else if (log.deviceEventId !== null && log.deviceEventId !== undefined) {
      pipeCell.value = log.deviceEventId
      if (typeof pipeCell.value === 'number') pipeCell.numFmt = '#,##0'
      pipeCell.font = bodyFont
    } else if (log.id) {
      pipeCell.value = escapeFormula(String(log.id).slice(0, 8))
      pipeCell.font = bodyFont
    } else {
      setMissing(pipeCell, 'center')
    }

    const tonVal = numericValue(log.tonnage)
    if (tonVal !== null && tonVal > 0) totalLogTons += tonVal
    styleNumericCells(row, [[7, log.tonnage, '#,##0.0000', true]], bodyFont)

    const statusCell = row.getCell(8)
    statusCell.value = log.isSpecified ? 'Specified' : 'Pending Tag'
    statusCell.font = log.isSpecified
      ? { name: FONT_FAMILY, size: 9, bold: true, color: { argb: COLOR.primary } }
      : { name: FONT_FAMILY, size: 9, italic: true, color: { argb: COLOR.subtle } }
    statusCell.alignment = { vertical: 'middle', horizontal: 'center' }

    applyRowBorder(row, 8, BORDER.bodyBottom)
    row.height = estimateRowHeight([{ text: customerText, width: colWidths[1] }], 9.5, 22, false)
  })

  const roundedTotalTons = Math.round(totalLogTons * 10000) / 10000
  styleTotalRow(sheet, lastLogRow + 1, 8, {
    1: { value: 'TOTAL (VISIBLE CUTS)', align: 'left' },
    6: { formula: `SUBTOTAL(3,A${firstLogRow}:A${lastLogRow})`, result: productionLogs.length, numFmt: PCT_UNIT_FMT, align: 'center' },
    7: { formula: `SUBTOTAL(9,G${firstLogRow}:G${lastLogRow})`, result: roundedTotalTons, numFmt: '#,##0.0000', align: 'right' },
  })
}

async function renderProductionWorkbook(workbook, report) {
  workbook.creator = COMPANY_NAME
  workbook.subject = 'Production Output Report'
  workbook.title = 'Production Output Report'
  workbook.calcProperties.fullCalcOnLoad = true

  const machineLabel = report.machine?.name
    ? `${report.machine.name} (${report.machine.code || 'M-01'})`
    : 'Spiral Mill 01 (M-01)'
  const canonicalS05 = `${OUTPUT_SENSOR_CODE} ${getSensorLabel(OUTPUT_SENSOR_CODE, 'Production Output Cutting')}`
  const sensorLabel = report.sensor?.label || canonicalS05
  const reportTypeLabel = `${capitalizeWord(report.reportType, 'Production')} Report`
  const periodWindow = formatPeriodWindowLabel(report)
  const generatedText = formatManilaDateText(report.generatedAt)
  const docRef = buildDocRef(report)

  renderProductionSummarySheet(workbook, report, {
    machineLabel,
    sensorLabel,
    reportTypeLabel,
    periodWindow,
    generatedText,
    docRef,
  })

  renderProductionCutLogsSheet(workbook, report, {
    machineLabel,
    reportTypeLabel,
    periodWindow,
    docRef,
  })
}

async function renderRegularWorkbook(workbook, report) {
  workbook.creator = COMPANY_NAME
  workbook.subject = 'Operational Report'
  workbook.title = 'Operational Report'
  workbook.calcProperties.fullCalcOnLoad = true

  const colWidths = [36, 28, 16, 18, 21]
  const sheet = workbook.addWorksheet('Operational Report', {
    properties: { defaultRowHeight: 20 },
  })
  sheet.columns = colWidths.map((width) => ({ width }))
  sheet.views = [{ showGridLines: false }]

  const machineLabel = report.machine?.name || 'Spiral Mill 01'
  applySheetPageSetup(sheet, { machineLabel })

  const reportTypeLabel = report.reportType
    ? `${capitalizeWord(report.reportType, 'Operational')} Report`
    : 'Operational Report'
  const periodWindow = formatPeriodWindowLabel(report)
  const observation = capitalizeWord(report.periodState, MISSING_PLACEHOLDER)
  const generatedText = formatManilaDateText(report.generatedAt)

  renderMasthead(sheet, {
    colCount: 5,
    splitCol: 3,
    title: `${COMPANY_NAME}  ·  Operational Report`,
    docRef: buildDocRef(report),
    metaLeft: `${reportTypeLabel}  ·  ${machineLabel}  ·  ${periodWindow}`,
    metaRight: `Observation: ${observation}\nGenerated ${generatedText}`,
  })

  const availability = numericValue(report.metrics?.availabilityPercent)
  const downtimeRows = Array.isArray(report.rows) ? report.rows : []
  const hasEventsSummary = Array.isArray(report.summary) && report.summary.some((item) => item.id === 'events')
  const isObserved = report.periodState !== 'future' && numericValue(report.metrics?.outputPieces) !== null
  const downtimeEventCount = hasEventsSummary
    ? summaryNumber(report, 'events')
    : (isObserved ? downtimeRows.length : null)

  renderKpiStrip(sheet, 4, [
    { label: 'PRODUCTION COUNT', value: numericValue(report.metrics?.outputPieces), numFmt: PCT_UNIT_FMT, exactFmt: true, align: 'left' },
    { label: 'AVAILABILITY', value: availability === null ? null : availability / 100, numFmt: '0.0%', exactFmt: true, align: 'right' },
    { label: 'DOWNTIME EVENTS', value: downtimeEventCount, numFmt: '#,##0', align: 'right' },
    { label: 'DOWNTIME DURATION', value: numericValue(report.metrics?.durationMinutes), numFmt: '#,##0.## "min"', align: 'right' },
    { label: 'ESTIMATED LOSS', value: numericValue(report.metrics?.estimatedLoss), numFmt: '#,##0.## "pcs"', align: 'right' },
  ], colWidths)

  sheet.getRow(6).height = 12
  let cursorRow = 7

  const processSensors = Array.isArray(report.processSensors) ? report.processSensors : []
  const bodyFont = { name: FONT_FAMILY, size: 9.5, color: { argb: COLOR.body } }

  if (processSensors.length > 0) {
    renderSectionTitle(sheet, cursorRow, 3, 'Process Sensor Activity')
    const sensorHeaderRow = cursorRow + 1
    styleHeaderRow(sheet, sensorHeaderRow, [
      { label: 'Code', align: 'left' },
      { label: 'Sensor', align: 'left' },
      { label: 'Pulses', align: 'right' },
    ], colWidths)

    const firstSensorRow = sensorHeaderRow + 1
    const lastSensorRow = firstSensorRow + processSensors.length - 1
    let pulseSum = 0
    let hasObservedPulse = false

    processSensors.forEach((sensor, idx) => {
      const row = sheet.getRow(firstSensorRow + idx)
      const code = escapeFormula(sensor.sensorCode || MISSING_PLACEHOLDER)
      const label = escapeFormula(sensor.sensorLabel || MISSING_PLACEHOLDER)

      row.getCell(1).value = code
      row.getCell(1).font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR.primary } }
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }

      row.getCell(2).value = label
      row.getCell(2).font = bodyFont
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

      const pulseCell = row.getCell(3)
      pulseCell.alignment = { vertical: 'middle', horizontal: 'right' }
      const count = numericValue(sensor.eventCount)
      if (count !== null) {
        pulseSum += count
        hasObservedPulse = true
      }
      setTypedNumber(pulseCell, sensor.eventCount, '#,##0', bodyFont)

      applyRowBorder(row, 3, BORDER.bodyBottom)
      row.height = estimateRowHeight([{ text: label, width: colWidths[1] }], 9.5, 22, false)
    })

    const sensorTotalRow = lastSensorRow + 1
    styleTotalRow(sheet, sensorTotalRow, 3, {
      1: { value: 'TOTAL PROCESS PULSES', align: 'left' },
      3: hasObservedPulse
        ? { formula: `SUM(C${firstSensorRow}:C${lastSensorRow})`, result: pulseSum, numFmt: '#,##0', align: 'right' }
        : { value: MISSING_PLACEHOLDER, align: 'right' },
    })
    if (!hasObservedPulse) {
      sheet.getRow(sensorTotalRow).getCell(3).font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLOR.subtle } }
    }

    sheet.getRow(sensorTotalRow + 1).height = 12
    cursorRow = sensorTotalRow + 2
  }

  renderSectionTitle(sheet, cursorRow, 5, 'Downtime Records')
  const downtimeHeaderRow = cursorRow + 1
  styleHeaderRow(sheet, downtimeHeaderRow, [
    { label: 'Cause', align: 'left' },
    { label: 'Sensor', align: 'left' },
    { label: 'Events', align: 'right' },
    { label: 'Duration (min)', align: 'right' },
    { label: 'Estimated Loss (pcs)', align: 'right' },
  ], colWidths)

  let afterTableRow

  if (downtimeRows.length === 0) {
    const emptyRow = downtimeHeaderRow + 1
    styleEmptyNoticeRow(sheet, emptyRow, 5, 'No downtime records for this period.')
    afterTableRow = emptyRow + 1
  } else {
    const firstDtRow = downtimeHeaderRow + 1
    const lastDtRow = firstDtRow + downtimeRows.length - 1
    sheet.autoFilter = `A${downtimeHeaderRow}:E${lastDtRow}`

    let sumEvents = 0
    let sumDuration = 0
    let sumLoss = 0

    downtimeRows.forEach((item, idx) => {
      const row = sheet.getRow(firstDtRow + idx)
      const cause = escapeFormula(item.cause || MISSING_PLACEHOLDER)
      const sensor = escapeFormula(item.sensor || MISSING_PLACEHOLDER)

      row.getCell(1).value = cause
      row.getCell(1).font = bodyFont
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

      row.getCell(2).value = sensor
      row.getCell(2).font = bodyFont
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

      const eventsVal = numericValue(item.events)
      const durVal = numericValue(item.durationMinutes)
      const lossVal = numericValue(item.estimatedLoss)
      if (eventsVal !== null) sumEvents += eventsVal
      if (durVal !== null) sumDuration += durVal
      if (lossVal !== null) sumLoss += lossVal

      styleNumericCells(row, [
        [3, item.events, '#,##0', false],
        [4, item.durationMinutes, '#,##0.##', false],
        [5, item.estimatedLoss, '#,##0.00', true],
      ], bodyFont)

      applyRowBorder(row, 5, BORDER.bodyBottom)
      row.height = estimateRowHeight([
        { text: cause, width: colWidths[0] },
        { text: sensor, width: colWidths[1] },
      ], 9.5, 22, false)
    })

    const dtTotalRow = lastDtRow + 1
    const roundedDuration = Math.round(sumDuration * 100) / 100
    const roundedLoss = Math.round(sumLoss * 100) / 100
    styleTotalRow(sheet, dtTotalRow, 5, {
      1: { value: 'TOTAL ATTRIBUTED DOWNTIME', align: 'left' },
      3: { formula: `SUM(C${firstDtRow}:C${lastDtRow})`, result: sumEvents, numFmt: '#,##0' },
      4: { formula: `SUM(D${firstDtRow}:D${lastDtRow})`, result: roundedDuration, numFmt: '#,##0.##' },
      5: { formula: `SUM(E${firstDtRow}:E${lastDtRow})`, result: roundedLoss, numFmt: '#,##0.00' },
    })
    afterTableRow = dtTotalRow + 1
  }

  sheet.getRow(afterTableRow).height = 8
  const rate = numericValue(report.lossEstimateBasis?.ratePiecesPerMinute)
  const rateLabel = rate !== null ? `${Math.round(rate * 60 * 100) / 100} pcs/hr` : MISSING_PLACEHOLDER
  const basisSource = report.lossEstimateBasis?.source || 'configured'
  const includedList = PROCESS_SENSOR_CODES.join(', ')
  renderFootnote(
    sheet,
    afterTableRow + 1,
    5,
    `Loss basis: ${rateLabel} (${basisSource}) · Process pulses cover ${includedList}; excludes S-03 & ${OUTPUT_SENSOR_CODE}.`,
  )
}

// ponytail: synchronous in-memory buffer ceiling: 10k events upgrade: stream via PassThrough to response
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
