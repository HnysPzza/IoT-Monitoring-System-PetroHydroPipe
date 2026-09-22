const PDFDocument = require('pdfkit')
const { strToU8, zipSync } = require('fflate')
const path = require('path')
const fs = require('fs')

const NOT_AVAILABLE = 'Not available'
const CSV_HEADERS = ['Cause', 'Sensor', 'Events', 'Duration Minutes', 'Estimated Loss']

const COMPANY_NAME = 'PETRO HYDRO PIPE CORP.'
const COMPANY_SUBTITLE = 'Industrial Steel Pipe Manufacturing • IoT Machine Monitoring Division'
const COMPANY_ADDRESS = 'Dunggoan, Danao City, Cebu, Philippines 6004'
const MACHINE_LABEL = 'Spiral Mill 01 (M-01)'
const XLSX_SHEET_NAME = 'Management Summary'
const EXCEL_DAY_MS = 24 * 60 * 60 * 1000
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

const LOGO_PATH = path.resolve(__dirname, '../../../../Frontend/public/assets/logo.png')

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

function csvCell(value) {
  const text = value === null || value === undefined || value === '' ? NOT_AVAILABLE : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function toCsv(report) {
  const metadata = [
    ['Generated At', report.generatedAt],
    ['Loss Rate Source', report.lossEstimateBasis?.source],
    ['Loss Rate Pieces Per Minute', report.lossEstimateBasis?.ratePiecesPerMinute],
  ].map(([label, value]) => `${csvCell(label)},${csvCell(value)}`)

  const table = [CSV_HEADERS, ...report.rows.map((row) => [
    row.cause,
    row.sensor,
    row.events,
    row.durationMinutes,
    row.estimatedLoss,
  ])].map((cells) => cells.map(csvCell).join(','))

  return [...metadata, '', ...table].join('\n')
}

const XLSX_STYLE = {
  body: 0,
  title: 1,
  subtitle: 2,
  metaLabel: 3,
  metaValue: 4,
  section: 5,
  tableHeader: 6,
  text: 7,
  integer: 8,
  decimal: 9,
  percent: 10,
  date: 11,
  dateTime: 12,
  note: 13,
  warning: 14,
  totalLabel: 15,
  totalNumber: 16,
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function xlsxCellValue(kind, value, styleId) {
  return { kind, value, styleId }
}

function excelSerial(value, timeZone = 'UTC') {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value)
    return result
  }, {})

  const normalized = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
  )

  return (normalized - EXCEL_EPOCH_MS) / EXCEL_DAY_MS
}

function dateOnlyCell(value) {
  const serial = excelSerial(`${value}T00:00:00.000Z`)
  return serial === null ? 'Not available' : xlsxCellValue('number', serial, XLSX_STYLE.date)
}

function manilaDateTimeCell(value) {
  const serial = excelSerial(value, 'Asia/Manila')
  return serial === null ? 'Not available' : xlsxCellValue('number', serial, XLSX_STYLE.dateTime)
}

function valueOrUnavailable(value) {
  return value === null || value === undefined || value === '' || Number.isNaN(value)
    ? 'Not available'
    : value
}

function metricValue(report, key) {
  const value = report.metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function xlsxCell(address, value, fallbackStyle = XLSX_STYLE.body) {
  if (value === null || value === undefined) return `<c r="${address}" s="${fallbackStyle}"/>`

  const kind = value?.kind || (typeof value === 'number' ? 'number' : 'text')
  const styleId = value?.styleId ?? fallbackStyle
  const cellValue = value?.value ?? value

  if (kind === 'number' || kind === 'formula') {
    if (kind === 'formula') {
      const cachedValue = cellValue.cachedValue === null || cellValue.cachedValue === undefined ? '' : cellValue.cachedValue
      return `<c r="${address}" s="${styleId}"><f>${xmlEscape(cellValue.formula)}</f><v>${xmlEscape(cachedValue)}</v></c>`
    }

    return `<c r="${address}" s="${styleId}"><v>${xmlEscape(cellValue)}</v></c>`
  }

  return `<c r="${address}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cellValue)}</t></is></c>`
}

function xlsxRow(rowNumber, cells, height) {
  const heightAttributes = height ? ` ht="${height}" customHeight="1"` : ''
  const cellXml = cells.map(([address, value, styleId]) => xlsxCell(address, value, styleId)).join('')
  return `<row r="${rowNumber}"${heightAttributes}>${cellXml}</row>`
}

function styledRowCells(rowNumber, styleId, value, columnCount = 5) {
  return Array.from({ length: columnCount }, (_, index) => [
    `${String.fromCharCode(65 + index)}${rowNumber}`,
    index === 0 ? value : null,
    styleId,
  ])
}

function xlsxStylesXml() {
  const fonts = [
    '<font><sz val="10"/><name val="Aptos"/></font>',
    '<font><b/><sz val="16"/><color rgb="FF0F172A"/><name val="Aptos Display"/></font>',
    '<font><sz val="10"/><color rgb="FF475569"/><name val="Aptos"/></font>',
    '<font><b/><sz val="10"/><color rgb="FF64748B"/><name val="Aptos"/></font>',
    '<font><b/><sz val="10"/><color rgb="FF1E293B"/><name val="Aptos"/></font>',
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>',
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>',
    '<font><b/><sz val="10"/><color rgb="FF9A3412"/><name val="Aptos"/></font>',
  ]
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFEDD5"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/><bgColor indexed="64"/></patternFill></fill>',
  ]
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin" color="FFD1D5DB"/><right style="thin" color="FFD1D5DB"/><top style="thin" color="FFD1D5DB"/><bottom style="thin" color="FFD1D5DB"/><diagonal/></border>',
    '<border><left style="medium" color="FF1E3A8A"/><right style="medium" color="FF1E3A8A"/><top style="medium" color="FF1E3A8A"/><bottom style="medium" color="FF1E3A8A"/><diagonal/></border>',
    '<border><left/><right/><top style="thin" color="FFD1D5DB"/><bottom style="thin" color="FFD1D5DB"/><diagonal/></border>',
  ]
  const alignments = {
    left: '<alignment horizontal="left" vertical="center"/>',
    center: '<alignment horizontal="center" vertical="center"/>',
    right: '<alignment horizontal="right" vertical="center"/>',
    wrap: '<alignment horizontal="left" vertical="center" wrapText="1"/>',
  }
  const xfs = [
    { font: 0, fill: 0, border: 0, alignment: alignments.left },
    { font: 1, fill: 0, border: 0, alignment: alignments.left },
    { font: 2, fill: 0, border: 0, alignment: alignments.left },
    { font: 3, fill: 3, border: 1, alignment: alignments.left },
    { font: 4, fill: 4, border: 1, alignment: alignments.left },
    { font: 5, fill: 2, border: 0, alignment: alignments.left },
    { font: 6, fill: 2, border: 1, alignment: alignments.center },
    { font: 0, fill: 0, border: 1, alignment: alignments.wrap },
    { font: 4, fill: 0, border: 1, numFmt: 3, alignment: alignments.right },
    { font: 0, fill: 0, border: 1, numFmt: 167, alignment: alignments.right },
    { font: 4, fill: 0, border: 1, numFmt: 166, alignment: alignments.right },
    { font: 0, fill: 0, border: 1, numFmt: 164, alignment: alignments.center },
    { font: 0, fill: 0, border: 1, numFmt: 165, alignment: alignments.center },
    { font: 2, fill: 0, border: 0, alignment: alignments.wrap },
    { font: 7, fill: 5, border: 1, numFmt: 167, alignment: alignments.right },
    { font: 4, fill: 3, border: 2, alignment: alignments.left },
    { font: 4, fill: 3, border: 2, numFmt: 3, alignment: alignments.right },
  ]
  const xfXml = xfs.map((xf) => {
    const attributes = [
      `numFmtId="${xf.numFmt || 0}"`,
      `fontId="${xf.font}"`,
      `fillId="${xf.fill}"`,
      `borderId="${xf.border}"`,
      'xfId="0"',
    ].join(' ')
    return `<xf ${attributes} applyAlignment="1">${xf.alignment}</xf>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4"><numFmt numFmtId="164" formatCode="dd mmm yyyy"/><numFmt numFmtId="165" formatCode="dd mmm yyyy hh:mm"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="#,##0.0"/></numFmts>
  <fonts count="${fonts.length}">${fonts.join('')}</fonts>
  <fills count="${fills.length}">${fills.join('')}</fills>
  <borders count="${borders.length}">${borders.join('')}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${xfs.length}">${xfXml}</cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleMedium9"/>
</styleSheet>`
}

function toXlsx(report) {
  const rows = []
  let rowNumber = 0
  const addRow = (cells, height) => {
    rowNumber += 1
    rows.push(xlsxRow(rowNumber, cells, height))
    return rowNumber
  }
  const addBlankRow = (height = 8) => addRow([], height)
  const addSection = (title) => {
    const sectionRow = rowNumber + 1
    return addRow(styledRowCells(sectionRow, XLSX_STYLE.section, title), 22)
  }

  addRow([['A1', COMPANY_NAME, XLSX_STYLE.title]], 26)
  addRow([['A2', COMPANY_ADDRESS, XLSX_STYLE.subtitle]], 18)
  addRow([['A3', COMPANY_SUBTITLE, XLSX_STYLE.subtitle]], 18)
  addRow([['A4', 'MANAGEMENT REPORT', XLSX_STYLE.title]], 24)

  addRow([
    ['A5', 'Exported (PHT)', XLSX_STYLE.metaLabel],
    ['B5', 'Report Type', XLSX_STYLE.metaLabel],
    ['C5', 'Reporting Date', XLSX_STYLE.metaLabel],
    ['D5', 'Status', XLSX_STYLE.metaLabel],
    ['E5', 'Machine', XLSX_STYLE.metaLabel],
  ], 18)
  addRow([
    ['A6', manilaDateTimeCell(report.generatedAt), XLSX_STYLE.dateTime],
    ['B6', String(report.reportType || 'daily').replace(/^./, (letter) => letter.toUpperCase()), XLSX_STYLE.metaValue],
    ['C6', dateOnlyCell(report.selectedDate), XLSX_STYLE.date],
    ['D6', String(report.periodState || 'complete').replace(/^./, (letter) => letter.toUpperCase()), XLSX_STYLE.metaValue],
    ['E6', MACHINE_LABEL, XLSX_STYLE.metaValue],
  ], 22)
  addRow([
    ['A7', 'Loss Rate Source', XLSX_STYLE.metaLabel],
    ['B7', 'Loss Rate (pcs/min)', XLSX_STYLE.metaLabel],
  ], 18)
  addRow([
    ['A8', report.lossEstimateBasis?.source || 'Not available', XLSX_STYLE.metaValue],
    ['B8', valueOrUnavailable(report.lossEstimateBasis?.ratePiecesPerMinute), XLSX_STYLE.decimal],
  ], 22)
  addBlankRow()

  const summarySectionRow = addSection('SUMMARY')
  const summaryHeaderRow = summarySectionRow + 1
  addRow([
    [`A${summaryHeaderRow}`, 'Metric', XLSX_STYLE.tableHeader],
    [`B${summaryHeaderRow}`, 'Value', XLSX_STYLE.tableHeader],
    [`C${summaryHeaderRow}`, 'Unit', XLSX_STYLE.tableHeader],
  ], 22)

  const production = metricValue(report, 'outputPieces')
  const availability = metricValue(report, 'availabilityPercent')
  const estimatedLoss = metricValue(report, 'estimatedLoss')
  const duration = metricValue(report, 'durationMinutes')
  const summaryRows = [
    ['Production Count', valueOrUnavailable(production), 'pcs', production === null ? XLSX_STYLE.text : XLSX_STYLE.integer],
    ['Availability', availability === null ? 'Not available' : xlsxCellValue('number', availability / 100, XLSX_STYLE.percent), '%', XLSX_STYLE.text],
    ['Estimated Loss', valueOrUnavailable(estimatedLoss), 'pcs', estimatedLoss > 0 ? XLSX_STYLE.warning : XLSX_STYLE.decimal],
    ['Downtime Events', (report.rows || []).length, 'events', XLSX_STYLE.integer],
    ['Downtime Duration', valueOrUnavailable(duration), 'min', XLSX_STYLE.decimal],
  ]
  summaryRows.forEach(([label, value, unit, valueStyle]) => {
    rowNumber += 1
    rows.push(xlsxRow(rowNumber, [
      [`A${rowNumber}`, label, XLSX_STYLE.text],
      [`B${rowNumber}`, value, valueStyle],
      [`C${rowNumber}`, unit, XLSX_STYLE.text],
    ], 21))
  })

  addBlankRow()
  const processSectionRow = addSection('SENSOR ACTIVITY')
  const processHeaderRow = processSectionRow + 1
  addRow([
    [`A${processHeaderRow}`, 'Sensor Code', XLSX_STYLE.tableHeader],
    [`B${processHeaderRow}`, 'Sensor Function', XLSX_STYLE.tableHeader],
    [`C${processHeaderRow}`, 'Recorded Events', XLSX_STYLE.tableHeader],
  ], 22)
  const processRows = report.processSensors || []
  if (processRows.length === 0) {
    rowNumber += 1
    rows.push(xlsxRow(rowNumber, [[`A${rowNumber}`, 'No process sensor activity recorded for this period.', XLSX_STYLE.note]], 21))
  } else {
    processRows.forEach((sensor) => {
      rowNumber += 1
      rows.push(xlsxRow(rowNumber, [
        [`A${rowNumber}`, sensor.sensorCode || 'Not available', XLSX_STYLE.text],
        [`B${rowNumber}`, sensor.sensorLabel || 'Not available', XLSX_STYLE.text],
        [`C${rowNumber}`, valueOrUnavailable(sensor.eventCount), XLSX_STYLE.integer],
      ], 21))
    })
  }

  addBlankRow()
  const downtimeSectionRow = addSection('DOWNTIME DETAIL')
  const downtimeHeaderRow = downtimeSectionRow + 1
  addRow([
    [`A${downtimeHeaderRow}`, 'Cause', XLSX_STYLE.tableHeader],
    [`B${downtimeHeaderRow}`, 'Sensor', XLSX_STYLE.tableHeader],
    [`C${downtimeHeaderRow}`, 'Events', XLSX_STYLE.tableHeader],
    [`D${downtimeHeaderRow}`, 'Duration (min)', XLSX_STYLE.tableHeader],
    [`E${downtimeHeaderRow}`, 'Estimated Loss (pcs)', XLSX_STYLE.tableHeader],
  ], 22)

  const downtimeRows = report.rows || []
  const downtimeStartRow = rowNumber + 1
  if (downtimeRows.length === 0) {
    rowNumber += 1
    rows.push(xlsxRow(rowNumber, [[`A${rowNumber}`, 'No machine downtime incidents recorded for this period.', XLSX_STYLE.note]], 21))
  } else {
    downtimeRows.forEach((downtime) => {
      rowNumber += 1
      rows.push(xlsxRow(rowNumber, [
        [`A${rowNumber}`, downtime.cause || 'Not available', XLSX_STYLE.text],
        [`B${rowNumber}`, downtime.sensor || 'Not available', XLSX_STYLE.text],
        [`C${rowNumber}`, valueOrUnavailable(downtime.events), XLSX_STYLE.integer],
        [`D${rowNumber}`, valueOrUnavailable(downtime.durationMinutes), XLSX_STYLE.decimal],
        [`E${rowNumber}`, valueOrUnavailable(downtime.estimatedLoss), downtime.estimatedLoss > 0 ? XLSX_STYLE.warning : XLSX_STYLE.decimal],
      ], 21))
    })
    const totalRow = rowNumber + 1
    rowNumber = totalRow
    rows.push(xlsxRow(rowNumber, [
      [`A${rowNumber}`, 'TOTAL ATTRIBUTED DOWNTIME', XLSX_STYLE.totalLabel],
      [`B${rowNumber}`, 'All operational stations', XLSX_STYLE.totalLabel],
      [`C${rowNumber}`, xlsxCellValue('formula', { formula: `SUM(C${downtimeStartRow}:C${rowNumber - 1})`, cachedValue: downtimeRows.reduce((sum, row) => sum + (Number(row.events) || 0), 0) }, XLSX_STYLE.totalNumber), XLSX_STYLE.totalNumber],
      [`D${rowNumber}`, xlsxCellValue('formula', { formula: `SUM(D${downtimeStartRow}:D${rowNumber - 1})`, cachedValue: downtimeRows.reduce((sum, row) => sum + (Number(row.durationMinutes) || 0), 0) }, XLSX_STYLE.totalNumber), XLSX_STYLE.totalNumber],
      [`E${rowNumber}`, xlsxCellValue('formula', { formula: `SUM(E${downtimeStartRow}:E${rowNumber - 1})`, cachedValue: downtimeRows.reduce((sum, row) => sum + (Number(row.estimatedLoss) || 0), 0) }, XLSX_STYLE.totalNumber), XLSX_STYLE.totalNumber],
    ], 22))
  }

  addBlankRow()
  const noteRow = rowNumber + 1
  addRow([['A' + noteRow, 'Prepared from recorded telemetry and downtime records. Values marked Not available were not observed in the selected period.', XLSX_STYLE.note]], 24)

  const lastRow = rowNumber
  const logoBuffer = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null
  const drawingXml = logoBuffer ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:colOff>900000</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1" descr="Company logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="900000" cy="490000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>` : null
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:E${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="16"/>
  <cols>
    <col min="1" max="1" width="31" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="16" customWidth="1"/><col min="5" max="5" width="18" customWidth="1"/>
  </cols>
  <sheetData>${rows.join('')}</sheetData>
  ${logoBuffer ? '<drawing r="rId1"/>' : ''}
</worksheet>`

  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logoBuffer ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${logoBuffer ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView visibility="visible" minimized="0" showHorizontalScroll="1" showVerticalScroll="1" showSheetTabs="1" tabRatio="600" firstSheet="0" activeTab="0" autoFilterDateGrouping="1"/></bookViews><sheets><sheet name="${XLSX_SHEET_NAME}" sheetId="1" state="visible" r:id="rId1"/></sheets><definedNames/><calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    'xl/styles.xml': strToU8(xlsxStylesXml()),
  }

  if (logoBuffer) {
    files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
    files['xl/drawings/drawing1.xml'] = strToU8(drawingXml)
    files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>')
    files['xl/media/image1.png'] = logoBuffer
  }

  return Buffer.from(zipSync(files, { level: 6 }))
}

function pdfText(value) {
  return value === null || value === undefined || value === '' ? NOT_AVAILABLE : String(value)
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
  const logoWidth = 44
  const logoGap = 12
  const textLeft = fs.existsSync(LOGO_PATH) ? left + logoWidth + logoGap : left

  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, left, top, { width: logoWidth, height: logoWidth })
    } catch {
      // Fallback cleanly if the image format fails to decode
    }
  }

  // Company Brand & Facility Info
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR.primary)
    .text(COMPANY_NAME, textLeft, top, { lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.textMuted)
    .text(COMPANY_SUBTITLE, textLeft, top + 16, { lineBreak: false })
  doc.font('Helvetica').fontSize(7.2).fillColor(COLOR.textLight)
    .text(`${COMPANY_ADDRESS}  •  Plant Line: ${MACHINE_LABEL}`, textLeft, top + 27, { lineBreak: false })

  // Right-aligned Document Title & Metadata
  const refCode = `PHP-RPT-${(report.reportType || 'DAILY').toUpperCase()}-${(report.selectedDate || '').replace(/[^a-zA-Z0-9]/g, '') || 'UNDATED'}`
  const rightColX = left + printableWidth - 210
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLOR.secondary)
    .text('OFFICIAL MONITORING REPORT', rightColX, top, { width: 210, align: 'right' })
  doc.font('Helvetica').fontSize(7.2).fillColor(COLOR.textLight)
    .text(`Doc Ref: ${refCode}`, rightColX, top + 14, { width: 210, align: 'right' })
  doc.font('Helvetica').fontSize(7.2).fillColor(COLOR.textLight)
    .text(`Generated: ${formatManilaDate(report.generatedAt)}`, rightColX, top + 25, { width: 210, align: 'right' })

  // Top Rule Divider
  const dividerY = top + 46
  doc.moveTo(left, dividerY).lineTo(left + printableWidth, dividerY)
    .lineWidth(1.5).strokeColor(COLOR.secondary).stroke()

  doc.y = dividerY + 10
}

function renderMetadataCard(doc, report) {
  const left = doc.page.margins.left
  const cardY = doc.y
  const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const cardHeight = 44

  // Card Background
  doc.roundedRect(left, cardY, printableWidth, cardHeight, 4)
    .fillAndStroke(COLOR.cardBg, COLOR.border)

  const colWidth = printableWidth / 4
  const paddingX = 8
  const paddingY = 8

  const metaItems = [
    { label: 'REPORT TYPE & DATE', val: `${(report.reportType || 'Daily').toUpperCase()} (${pdfText(report.selectedDate)})` },
    { label: 'OBSERVATION STATUS', val: (report.periodState || 'complete').toUpperCase() },
    { label: 'TARGET MACHINE', val: MACHINE_LABEL },
    { label: 'LOSS ESTIMATE BASIS', val: `${report.lossEstimateBasis?.ratePiecesPerMinute ?? '0.05'} pcs/min (${report.lossEstimateBasis?.source || 'configured'})` },
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
    // 1. Calculate the maximum text height across all cells in this row
    let maxContentHeight = 0
    row.forEach((cellVal, colIndex) => {
      const col = columns[colIndex]
      doc.font(col.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
      const textHeight = doc.heightOfString(pdfText(cellVal), { width: col.width - 12 })
      if (textHeight > maxContentHeight) maxContentHeight = textHeight
    })

    const rowHeight = Math.max(maxContentHeight + 8, 18)

    // 2. Multi-page boundary check (Pagination)
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage()
      doc.y = doc.page.margins.top + 8
      if (onNewPage) onNewPage()
      drawHeader()
    }

    const rowY = doc.y

    // 3. Row background shading
    const isEven = rowIndex % 2 === 1
    doc.rect(left, rowY, printableWidth, rowHeight).fill(isEven ? COLOR.rowEven : COLOR.rowOdd)

    // 4. Cell text rendering
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

    // 5. Row Bottom Border
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

    // 2. Section 1: Key Performance & Operational Summary Table
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

    // 3. Section 2: Process Sensor Telemetry (Station Pulses)
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

    // 4. Section 3: Downtime & Production Loss Attribution Breakdown Table
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

    // If rows exist, compute and append summary totals
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

    // 5. Official Certification / Signoff
    renderSignoffBlock(doc)

    // 6. Running Page Headers (Page 2+) and Footers (All Pages)
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)

      const savedTopMargin = doc.page.margins.top
      const savedBottomMargin = doc.page.margins.bottom
      doc.page.margins.top = 0
      doc.page.margins.bottom = 0

      // Header on continuation pages (Page 2 and beyond)
      if (i > range.start) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.textLight)
          .text(`${COMPANY_NAME} • Official Monitoring Report (${pdfText(report.selectedDate)})`, doc.page.margins.left, 20, {
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

function buildExportFilename({ reportType, selectedDate, format }) {
  return `report-${reportType}-${selectedDate || 'undated'}.${format}`
}

function contentTypeFor(format) {
  if (format === 'pdf') return 'application/pdf'
  if (format === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return 'text/csv; charset=utf-8'
}

module.exports = {
  buildExportFilename,
  contentTypeFor,
  toCsv,
  toPdf,
  toXlsx,
}
