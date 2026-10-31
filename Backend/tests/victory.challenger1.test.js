const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { calculatePipeTonnage } = require('../src/modules/production/production.service')
const reportsService = require('../src/modules/reports/reports.service')
const reportsExportSerializer = require('../src/modules/reports/reportsExport.serializer')
const reportsXlsxSerializer = require('../src/modules/reports/reportsXlsx.serializer')
const { PGlite } = require('@electric-sql/pglite')
const fs = require('node:fs')
const path = require('node:path')

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

  const weightKgPerMeter = (d - t) * t * 0.02466
  const totalWeightTons = (weightKgPerMeter * l) / 1000000
  return Math.round(totalWeightTons * 10000) / 10000
}

describe('Milestone 6 Challenger Victory 1: Empirical Full Stack Verification', () => {

  test('Challenge 1.1: Standard Industry Spiral Welded Pipe Catalog Verification', () => {
    const catalogSamples = [
      { od: 625.4, t: 10.0, l: 6000, expectedKgPerM: 151.75764, expectedTons: 0.9105 },
      { od: 1020.0, t: 12.7, l: 12000, expectedKgPerM: 315.46743, expectedTons: 3.7856 },
      { od: 1120.0, t: 10.0, l: 9000, expectedKgPerM: 273.726, expectedTons: 2.4635 },
      { od: 508.0, t: 6.35, l: 6000, expectedKgPerM: 78.55248, expectedTons: 0.4713 },
      { od: 711.2, t: 9.53, l: 12000, expectedKgPerM: 164.89971, expectedTons: 1.9788 },
      { od: 812.8, t: 12.7, l: 12000, expectedKgPerM: 250.5756, expectedTons: 3.0069 },
      { od: 914.4, t: 12.7, l: 12000, expectedKgPerM: 282.4000, expectedTons: 3.3888 },
      { od: 1219.2, t: 14.27, l: 12000, expectedKgPerM: 424.0129, expectedTons: 5.0882 },
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
    // (10 - 0.1) * 0.1 * 0.02466 * 100 / 1e6 = 9.9 * 0.1 * 0.02466 * 100 / 1e6 = 0.000244134 / 1e2 = 0.00000244...
    // rounds to 0.0000
    const tinyTonnage = calculatePipeTonnage(10, 0.1, 100)
    assert.equal(tinyTonnage, 0) // Rounded to 4 decimal places is 0.0000 = 0
  })

  test('Challenge 3: Database RPC Batch Update Strictly Preserves Physical Pipe Numbers', async () => {
    // Setup in-memory PGlite with schema and migration 051
    const pglite = new PGlite()

    // Create required roles for migration grants
    await pglite.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
    `)

    // Create minimal schema prerequisite for migration 051
    await pglite.exec(`
      create table if not exists public.machines (
        id uuid primary key default gen_random_uuid(),
        machine_code text unique not null,
        name text not null
      );
      create table if not exists public.sensors (
        id uuid primary key default gen_random_uuid(),
        sensor_code text unique not null,
        machine_id uuid references public.machines(id)
      );
      create table if not exists public.sensor_events (
        id uuid primary key default gen_random_uuid(),
        machine_id uuid references public.machines(id),
        sensor_id uuid references public.sensors(id),
        event_type text not null,
        output_accepted boolean,
        output_rejection_reason text,
        device_event_id text,
        recorded_at timestamptz not null default now()
      );
      create table if not exists public.production_item_specs (
        sensor_event_id uuid primary key references public.sensor_events(id),
        label text,
        size text,
        radius numeric,
        circumference numeric,
        diameter numeric(10, 2),
        updated_at timestamptz not null default now(),
        updated_by uuid
      );
      create table if not exists public.audit_logs (
        id uuid primary key default gen_random_uuid(),
        user_id uuid,
        action text not null,
        entity_type text not null,
        entity_id uuid,
        metadata jsonb,
        created_at timestamptz not null default now()
      );
      create or replace function public.get_backend_readiness() returns integer language sql as $$ select 50; $$;
    `)

    // Apply migration 051
    const migrationPath = path.resolve(__dirname, '../database/migrations/051_align_production_specs_pipe_manufacturing.sql')
    const migrationSql = fs.readFileSync(migrationPath, 'utf8')
    await pglite.exec(migrationSql)

    // Verify readiness bumped to 51
    const readinessRes = await pglite.query('select public.get_backend_readiness() as readiness')
    assert.equal(readinessRes.rows[0].readiness, 51)

    // Seed test machine and S-05 sensor
    const machineRes = await pglite.query(`
      insert into public.machines (machine_code, name) values ('M-01', 'Spiral Mill 01') returning id
    `)
    const machineId = machineRes.rows[0].id

    const sensorRes = await pglite.query(`
      insert into public.sensors (sensor_code, machine_id) values ('S-05', $1) returning id
    `, [machineId])
    const sensorId = sensorRes.rows[0].id

    // Seed 3 accepted cutting events
    const event1Res = await pglite.query(`
      insert into public.sensor_events (machine_id, sensor_id, event_type, output_accepted, recorded_at)
      values ($1, $2, 'pulse', true, now() - interval '30 minutes') returning id
    `, [machineId, sensorId])
    const event1Id = event1Res.rows[0].id

    const event2Res = await pglite.query(`
      insert into public.sensor_events (machine_id, sensor_id, event_type, output_accepted, recorded_at)
      values ($1, $2, 'pulse', true, now() - interval '20 minutes') returning id
    `, [machineId, sensorId])
    const event2Id = event2Res.rows[0].id

    const event3Res = await pglite.query(`
      insert into public.sensor_events (machine_id, sensor_id, event_type, output_accepted, recorded_at)
      values ($1, $2, 'pulse', true, now() - interval '10 minutes') returning id
    `, [machineId, sensorId])
    const event3Id = event3Res.rows[0].id

    // Assign specs to event 1 (pipe_number = 101) and event 2 (pipe_number = 102) using single update RPC
    await pglite.query(`
      select * from public.update_production_log_spec(
        p_sensor_event_id := $1,
        p_customer := 'Client Alpha',
        p_diameter := 625.4,
        p_thickness := 10.0,
        p_length := 6000,
        p_pipe_number := 101
      )
    `, [event1Id])

    await pglite.query(`
      select * from public.update_production_log_spec(
        p_sensor_event_id := $1,
        p_customer := 'Client Beta',
        p_diameter := 812.8,
        p_thickness := 12.7,
        p_length := 12000,
        p_pipe_number := 102
      )
    `, [event2Id])

    // Event 3 has NO spec row initially (unlabeled/unspecified)

    // Verify initial state
    const init1 = (await pglite.query('select * from public.production_item_specs where sensor_event_id = $1', [event1Id])).rows[0]
    const init2 = (await pglite.query('select * from public.production_item_specs where sensor_event_id = $1', [event2Id])).rows[0]
    assert.equal(init1.pipe_number, 101)
    assert.equal(init2.pipe_number, 102)

    // NOW execute batch update over all 3 events to assign new Customer, Diameter, Thickness, Length
    const batchRes = await pglite.query(`
      select * from public.batch_update_production_log_specs(
        p_sensor_event_ids := $1,
        p_customer := 'Universal Mega Corp',
        p_diameter := 1020.0,
        p_thickness := 12.7,
        p_length := 12000
      )
    `, [[event1Id, event2Id, event3Id]])

    assert.equal(batchRes.rows[0].matched_count, 3)
    assert.equal(batchRes.rows[0].updated_count, 3)

    // EMPIRICAL INVARIANT CHECK:
    // Event 1 specs: updated dimensions/customer, pipe_number PRESERVED as 101
    const post1 = (await pglite.query('select * from public.production_item_specs where sensor_event_id = $1', [event1Id])).rows[0]
    assert.equal(post1.customer, 'Universal Mega Corp')
    assert.equal(Number(post1.diameter), 1020.0)
    assert.equal(Number(post1.thickness), 12.7)
    assert.equal(Number(post1.length), 12000.0)
    assert.equal(post1.pipe_number, 101, 'CRITICAL FAILURE: Event 1 pipe_number was altered by batch update!')

    // Event 2 specs: updated dimensions/customer, pipe_number PRESERVED as 102
    const post2 = (await pglite.query('select * from public.production_item_specs where sensor_event_id = $1', [event2Id])).rows[0]
    assert.equal(post2.customer, 'Universal Mega Corp')
    assert.equal(Number(post2.diameter), 1020.0)
    assert.equal(Number(post2.thickness), 12.7)
    assert.equal(Number(post2.length), 12000.0)
    assert.equal(post2.pipe_number, 102, 'CRITICAL FAILURE: Event 2 pipe_number was altered by batch update!')

    // Event 3 specs: updated dimensions/customer, pipe_number remains null (not invented)
    const post3 = (await pglite.query('select * from public.production_item_specs where sensor_event_id = $1', [event3Id])).rows[0]
    assert.equal(post3.customer, 'Universal Mega Corp')
    assert.equal(Number(post3.diameter), 1020.0)
    assert.equal(post3.pipe_number, null, 'Event 3 should have null pipe_number')

    await pglite.close()
  })

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
    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsxBuffer)

    const summarySheet = workbook.getWorksheet('Production Summary')
    assert.ok(summarySheet, 'Production Summary worksheet missing')

    // Total Tonnage summary cell E8
    const totalTonsSummaryVal = summarySheet.getCell('E8').value
    assert.equal(totalTonsSummaryVal, 4.6961)

    // Breakdown rows: row 13 is MCWD, row 14 is Regan, row 15 is Unspecified
    const row13 = summarySheet.getRow(13)
    assert.equal(row13.getCell(1).value, 'MCWD')
    assert.equal(row13.getCell(2).value, 625.4)
    assert.equal(row13.getCell(3).value, 10.0)
    assert.equal(row13.getCell(4).value, 6000)
    assert.equal(row13.getCell(5).value, 1)
    assert.equal(row13.getCell(6).value, 0.9105)

    const row15 = summarySheet.getRow(15) // Unspecified
    assert.equal(row15.getCell(1).value, 'Unspecified / Pending Tag')
    assert.equal(row15.getCell(2).value, 'N/A')
    assert.equal(row15.getCell(3).value, 'N/A')
    assert.equal(row15.getCell(4).value, 'N/A')
    assert.equal(row15.getCell(6).value, 'N/A')

    const logsSheet = workbook.getWorksheet('Production Cut Logs')
    assert.ok(logsSheet, 'Production Cut Logs worksheet missing')

    const logRow6 = logsSheet.getRow(6) // Log 1
    assert.equal(logRow6.getCell(2).value, 'MCWD')
    assert.equal(logRow6.getCell(3).value, 625.4)
    assert.equal(logRow6.getCell(4).value, 10.0)
    assert.equal(logRow6.getCell(5).value, 6000)
    assert.equal(logRow6.getCell(6).value, 1)
    assert.equal(logRow6.getCell(7).value, 0.9105)

    const logRow8 = logsSheet.getRow(8) // Unspecified Log 3
    assert.equal(logRow8.getCell(2).value, 'Pending Tag')
    assert.equal(logRow8.getCell(3).value, 'N/A')
    assert.equal(logRow8.getCell(6).value, '33333333') // fallback slice id
    assert.equal(logRow8.getCell(7).value, 'N/A')
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
      const weightKgPerMeter = (d - t) * t * 0.02466
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
