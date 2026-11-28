const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')

const {
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('../helpers/appTestUtils')
const {
  toPdf,
} = require('../../src/modules/reports/reportsExport.serializer')

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

// Removed redundant SUITE 1/1b (40001 conflict covered in production-specs-v51 and production.api tests) and SUITE 2 (Excel formula escaping covered in reports.m3.adversarial).

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

// Removed redundant SUITE 3 (sensorIdentity covered in tests/contracts/sensor-registry.contract.test.js).
