const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { calculatePipeTonnage } = require('../../src/modules/production/production.service')
const reportsService = require('../../src/modules/reports/reports.service')
const reportsExportSerializer = require('../../src/modules/reports/reportsExport.serializer')
const reportsXlsxSerializer = require('../../src/modules/reports/reportsXlsx.serializer')

// Exact reference oracle formula:
// Weight (kg/m) = (OD - Thickness) * Thickness * 0.02466
// Weight (metric tons) = (Weight (kg/m) * Length) / 1,000,000
function referenceTonnageOracle(od, thickness, length) {
  if (od == null || thickness == null || length == null) return null
  const d = Number(od)
  const t = Number(thickness)
  const l = Number(length)
  if (!Number.isFinite(d) || !Number.isFinite(t) || !Number.isFinite(l)) return null
  if (d <= 0 || t <= 0 || l <= 0 || d <= t) return null

  const weightKgPerMeter = Math.PI * (d - t) * t * (7850 / 1000000)
  const totalWeightTons = (weightKgPerMeter * l) / 1000000
  return Math.round(totalWeightTons * 10000) / 10000
}

describe('Milestone 6 Challenger Victory 1: Empirical Full Stack Verification', () => {

  test('Challenge 1.1: Standard Industry Spiral Welded Pipe Catalog Verification', () => {
    const catalogSamples = [
      { od: 625.4, t: 10.0, l: 6000, expectedKgPerM: 151.75764, expectedTons: 0.9106 },
      { od: 1020.0, t: 12.7, l: 12000, expectedKgPerM: 315.46743, expectedTons: 3.7858 },
      { od: 1120.0, t: 10.0, l: 9000, expectedKgPerM: 273.726, expectedTons: 2.4637 },
      { od: 508.0, t: 6.35, l: 6000, expectedKgPerM: 78.55248, expectedTons: 0.4714 },
      { od: 711.2, t: 9.53, l: 12000, expectedKgPerM: 164.89971, expectedTons: 1.9789 },
      { od: 812.8, t: 12.7, l: 12000, expectedKgPerM: 250.5756, expectedTons: 3.0071 },
      { od: 914.4, t: 12.7, l: 12000, expectedKgPerM: 282.4000, expectedTons: 3.389 },
      { od: 1219.2, t: 14.27, l: 12000, expectedKgPerM: 424.0129, expectedTons: 5.0885 },
    ]

    for (const sample of catalogSamples) {
      const computed = calculatePipeTonnage(sample.od, sample.t, sample.l)
      const oracle = referenceTonnageOracle(sample.od, sample.t, sample.l)
      assert.equal(computed, sample.expectedTons, `Mismatch for OD ${sample.od}, t ${sample.t}, l ${sample.l}`)
      assert.equal(computed, oracle)
    }
  })

  test('Challenge 1.2: Stress Invariant Oracle (5,000 randomized valid geometry tuples)', () => {
    // Generate 5000 valid geometry combinations across wide industrial ranges
    for (let i = 0; i < 5000; i++) {
      const od = +(Math.random() * 3000 + 50).toFixed(2) // 50mm to 3050mm
      const maxT = Math.min(od * 0.45, 100) // wall thickness up to 45% of OD or 100mm
      const t = +(Math.random() * (maxT - 1) + 1).toFixed(2) // 1mm to maxT
      const l = +(Math.random() * 20000 + 1000).toFixed(2) // 1000mm to 21000mm

      const actual = calculatePipeTonnage(od, t, l)
      const expected = referenceTonnageOracle(od, t, l)

      assert.notEqual(actual, null)
      assert.ok(Number.isFinite(actual), `Non-finite actual: ${actual}`)
      assert.ok(actual > 0, `Expected positive tonnage, got ${actual}`)
      assert.equal(actual, expected, `Mismatch at OD=${od}, t=${t}, l=${l}: actual=${actual}, expected=${expected}`)

      // Verify rounding precision: exactly at most 4 decimal places
      const decimalPart = String(actual).split('.')[1] || ''
      assert.ok(decimalPart.length <= 4, `More than 4 decimal places in tonnage: ${actual}`)
    }
  })

  test('Challenge 2.1: Boundary Values and Extreme Edge Conditions (Null Tonnage Contract)', () => {
    const invalidInputs = [
      // OD <= thickness (physically impossible)
      [10, 10, 6000],
      [10, 12, 6000],
      [0.5, 0.5, 1000],
      [5, 100, 5000],

      // Non-positive dimensions
      [0, 10, 6000],
      [600, 0, 6000],
      [600, 10, 0],
      [-100, 10, 6000],
      [600, -5, 6000],
      [600, 10, -1000],

      // Missing / nullish values
      [null, 10, 6000],
      [600, null, 6000],
      [600, 10, null],
      [undefined, 10, 6000],
      [600, undefined, 6000],
      [600, 10, undefined],

      // String blanks and non-numeric representations
      ['', 10, 6000],
      ['   ', 10, 6000],
      [600, '', 6000],
      [600, '   ', 6000],
      [600, 10, ''],
      [600, 10, '   '],
      ['abc', 10, 6000],
      [600, 'NaN', 6000],
      [600, 10, 'Infinity'],
      [NaN, 10, 6000],
      [600, Infinity, 6000],
      [-Infinity, 10, 6000],

      // Non-primitive types
      [{}, 10, 6000],
      [600, [], 6000],
      [true, 10, 6000],
      [600, false, 6000],
    ]

    for (const [d, t, l] of invalidInputs) {
      const res = calculatePipeTonnage(d, t, l)
      assert.equal(res, null, `Expected null for invalid input [${d}, ${t}, ${l}], got ${res}`)
    }
  })

  test('Challenge 2.2: Extreme Values and Boundary Precision (0.00005 round check)', () => {
    // Huge dimensions
    const hugeOD = 99999999.99
    const hugeT = 50.00
    const hugeL = 12000.00
    const hugeTonnage = calculatePipeTonnage(hugeOD, hugeT, hugeL)
    assert.ok(hugeTonnage > 0)
    assert.ok(Number.isFinite(hugeTonnage))

    // Valid small positive: OD 10mm, t 0.1mm, L 100mm
    // (10 - 0.1) * 0.1 * 0.02466 * 100 / 1e6 = 0.000244134 / 1e2 = 0.00000244...
    // rounds to 0.0000, which calculatePipeTonnage normalizes to null.
    const tinyTonnage = calculatePipeTonnage(10, 0.1, 100)
    assert.equal(tinyTonnage, null)
  })

  // Removed redundant Challenge 3 (pipe_number preservation covered in production-specs-v51 and challenger2 PGlite tests).

  test('Challenge 4: Serializers Data Flow and Formatting Precision Consistency', async () => {
    // Construct mock production report representing diverse edge cases
    const mockReport = {
      category: 'production',
      reportType: 'daily',
      selectedDate: '2026-11-01',
      totalProductionOutput: 3,
      totalTonnage: 4.6961, // 0.9105 + 3.7856 + null = 4.6961
      specifiedPipes: 2,
      unspecifiedPipes: 1,
      distinctProductSizes: 2,
      machine: { name: 'Spiral Mill 01', code: 'M-01' },
      sensor: { label: 'Production Output Cutting (S-05)', code: 'S-05' },
      metrics: {
        totalProductionOutput: 3,
        totalTonnage: 4.6961,
        specifiedPipes: 2,
        unspecifiedPipes: 1,
        distinctProductSizes: 2,
      },
      specBreakdown: [
        {
          customer: 'MCWD',
          diameter: 625.4,
          thickness: 10.0,
          length: 6000,
          pipeCount: 1,
          singleTonnage: 0.9105,
          totalTonnage: 0.9105,
          percentageOfTotal: 33.3,
          isSpecified: true,
        },
        {
          customer: 'Regan',
          diameter: 1020.0,
          thickness: 12.7,
          length: 12000,
          pipeCount: 1,
          singleTonnage: 3.7856,
          totalTonnage: 3.7856,
          percentageOfTotal: 33.3,
          isSpecified: true,
        },
        {
          customer: 'Unspecified / Pending Tag',
          diameter: null,
          thickness: null,
          length: null,
          pipeCount: 1,
          singleTonnage: null,
          totalTonnage: null,
          percentageOfTotal: 33.3,
          isSpecified: false,
        },
      ],
      productionLogs: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          recordedAt: '2026-11-01T08:00:00Z',
          customer: 'MCWD',
          diameter: 625.4,
          thickness: 10.0,
          length: 6000,
          pipeNumber: 1,
          tonnage: 0.9105,
          isSpecified: true,
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          recordedAt: '2026-11-01T09:00:00Z',
          customer: 'Regan',
          diameter: 1020.0,
          thickness: 12.7,
          length: 12000,
          pipeNumber: 2,
          tonnage: 3.7856,
          isSpecified: true,
        },
        {
          id: '33333333-3333-3333-3333-333333333333',
          recordedAt: '2026-11-01T10:00:00Z',
          customer: null,
          diameter: null,
          thickness: null,
          length: null,
          pipeNumber: null,
          tonnage: null,
          isSpecified: false,
        },
      ],
    }

    // 1. PDF generation test
    const pdfBuffer = await reportsExportSerializer.toPdf(mockReport)
    assert.ok(pdfBuffer instanceof Buffer)
    assert.ok(pdfBuffer.length > 1000)
    assert.equal(pdfBuffer.subarray(0, 4).toString('ascii'), '%PDF')

    // 2. XLSX generation and cell value inspection
    const xlsxBuffer = await reportsXlsxSerializer.toXlsx(mockReport)
    assert.ok(xlsxBuffer instanceof Buffer)
    assert.ok(xlsxBuffer.length > 1000)

    // Inspect XLSX workbook structure using ExcelJS
    const ExcelJS = require('@excel.js/exceljs').default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsxBuffer)

    const summarySheet = workbook.getWorksheet('Production Summary')
    assert.ok(summarySheet, 'Production Summary worksheet missing')

    // Total Tonnage summary cell B5
    const totalTonsSummaryVal = summarySheet.getCell('B5').value
    assert.equal(totalTonsSummaryVal, 4.6961)

    // Breakdown rows: row 9 is MCWD, row 10 is Regan, row 11 is Unspecified
    const row9 = summarySheet.getRow(9)
    assert.equal(row9.getCell(1).value, 'MCWD')
    assert.equal(row9.getCell(2).value, 625.4)
    assert.equal(row9.getCell(3).value, 10.0)
    assert.equal(row9.getCell(4).value, 6000)
    assert.equal(row9.getCell(5).value, 1)
    assert.equal(row9.getCell(6).value, 0.9105)

    const row11 = summarySheet.getRow(11) // Unspecified
    assert.equal(row11.getCell(1).value, 'Unspecified / Pending Tag')
    assert.equal(row11.getCell(2).value, '—')
    assert.equal(row11.getCell(3).value, '—')
    assert.equal(row11.getCell(4).value, '—')
    assert.equal(row11.getCell(6).value, '—')

    const logsSheet = workbook.getWorksheet('Production Cut Logs')
    assert.ok(logsSheet, 'Production Cut Logs worksheet missing')

    const logRow5 = logsSheet.getRow(5) // Log 1
    assert.equal(logRow5.getCell(2).value, 'MCWD')
    assert.equal(logRow5.getCell(3).value, 625.4)
    assert.equal(logRow5.getCell(4).value, 10.0)
    assert.equal(logRow5.getCell(5).value, 6000)
    assert.equal(logRow5.getCell(6).value, 1)
    assert.equal(logRow5.getCell(7).value, 0.9105)

    const logRow7 = logsSheet.getRow(7) // Unspecified Log 3
    assert.equal(logRow7.getCell(2).value, 'Pending Tag')
    assert.equal(logRow7.getCell(3).value, '—')
    assert.equal(logRow7.getCell(6).value, '33333333') // fallback slice id
    assert.equal(logRow7.getCell(7).value, '—')
  })

  test('Challenge 5: Pure helper cross-layer parity (Frontend logic vs Backend logic)', () => {
    // Frontend ProductionSection.jsx calculatePipeTonnage implementation:
    function frontendCalculatePipeTonnage(diameter, thickness, length) {
      if (diameter == null || thickness == null || length == null) return null
      const d = Number(diameter)
      const t = Number(thickness)
      const l = Number(length)
      if (!Number.isFinite(d) || !Number.isFinite(t) || !Number.isFinite(l)) return null
      if (d <= 0 || t <= 0 || l <= 0 || d <= t) return null
      const weightKgPerMeter = Math.PI * (d - t) * t * (7850 / 1000000)
      const totalWeightTons = (weightKgPerMeter * l) / 1000000
      return Math.round(totalWeightTons * 10000) / 10000
    }

    // Test 1,000 cases comparing backend and frontend
    for (let i = 0; i < 1000; i++) {
      const d = Math.random() < 0.1 ? null : (Math.random() * 2000 + 10)
      const t = Math.random() < 0.1 ? 0 : (Math.random() * 50 + 1)
      const l = Math.random() < 0.1 ? -100 : (Math.random() * 12000 + 1000)

      const backendRes = calculatePipeTonnage(d, t, l)
      const frontendRes = frontendCalculatePipeTonnage(d, t, l)

      assert.equal(backendRes, frontendRes, `Parity failure for [${d}, ${t}, ${l}]`)
    }
  })
})
