const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const publicDocs = ['ARCHITECTURE.md', 'PRD.md', 'README.md', 'RUNBOOK.md', 'TDD.md']

test('public documentation is complete and excludes obsolete sensor mappings', () => {
  const obsoletePatterns = [
    /S-03\s*[-:|]\s*Coil Joint/i,
    /S-02\s*[-:|]\s*Outside Filler(?!\s*Wire)/i,
    /S-04\s*[-:|]\s*Inside Filler(?!\s*Wire)/i,
  ]

  for (const fileName of publicDocs) {
    const filePath = path.join(root, 'docs', fileName)
    assert.ok(fs.existsSync(filePath), `Public doc ${fileName} must exist`)
    const content = fs.readFileSync(filePath, 'utf8')
    for (const pattern of obsoletePatterns) assert.doesNotMatch(content, pattern)
  }
})

test('public documentation index links only to tracked public documents', () => {
  const readme = fs.readFileSync(path.join(root, 'docs/README.md'), 'utf8')
  const linkedDocs = [...readme.matchAll(/\]\(\.\/([^#)]+\.md)(?:#[^)]+)?\)/g)]
    .map((match) => decodeURIComponent(match[1]))

  assert.deepEqual([...new Set(linkedDocs)].sort(), publicDocs.filter((name) => name !== 'README.md').sort())
  for (const fileName of linkedDocs) {
    assert.ok(fs.existsSync(path.join(root, 'docs', fileName)), `Linked doc ${fileName} must exist`)
  }
})

test('database guide documents migrations 008 through 018', () => {
  const content = fs.readFileSync(path.resolve(__dirname, '../../database/README.md'), 'utf8')

  for (let migration = 8; migration <= 18; migration += 1) {
    assert.match(content, new RegExp(`0${migration}_`))
  }
  assert.match(content, /S-02 Inside Filler Wire/)
  assert.match(content, /S-04 Outside Filler Wire/)
  assert.match(content, /WATCHDOG_MODE=disabled/)
  assert.match(content, /POST \/api\/iot\/heartbeats/)
})

test('public operations docs preserve the watchdog safety boundary', () => {
  const environment = fs.readFileSync(path.join(root, 'Backend/.env.example'), 'utf8')
  const architecture = fs.readFileSync(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8')
  const runbook = fs.readFileSync(path.join(root, 'docs/RUNBOOK.md'), 'utf8')

  assert.match(environment, /WATCHDOG_MODE=disabled/)
  assert.match(architecture, /Connectivity loss.*cannot create production downtime/i)
  assert.match(architecture, /get_machine_live_snapshot/)
  assert.match(runbook, /Do not use enforce mode as a UI test/i)
  assert.match(runbook, /Preserve settings history.*runtime\/transition evidence/i)
})

test('device docs keep schedules server-owned and heartbeats independent from production', () => {
  const architecture = fs.readFileSync(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8')
  const tdd = fs.readFileSync(path.join(root, 'docs/TDD.md'), 'utf8')

  for (const content of [architecture, tdd]) {
    assert.match(content, /No physical ESP32.*integrated/i)
    assert.match(content, /backend.*authoritative.*shift.*break/i)
    assert.match(content, /heartbeats.*independent.*production pulses/i)
    assert.match(content, /must not.*store.*schedule/i)
    assert.match(content, /must not.*downtime.*merely because.*pulse/i)
    assert.match(content, /explicit.*fault.*during.*break.*record/i)
    assert.match(content, /S-05.*absence detection.*prohibited/i)
  }

  assert.match(tdd, /Normal production sequence/i)
  assert.match(tdd, /Planned break sequence/i)
  assert.match(tdd, /Genuine fault sequence/i)
  assert.match(tdd, /POST `?\/api\/iot\/heartbeats`?/i)
})
