const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('markdown docs do not contain obsolete legacy sensor mappings', () => {
  const docFiles = [
    path.resolve(__dirname, '../../../docs/PRD.md'),
    path.resolve(__dirname, '../../../docs/TDD.md'),
    path.resolve(__dirname, '../../../docs/ARCHITECTURE.md'),
    path.resolve(__dirname, '../../../docs/README.md'),
    path.resolve(__dirname, '../../../docs/ForUrgentWork/ForUrgentFix.md'),
    path.resolve(__dirname, '../../../docs/ForUrgentWork/Plan/2026-08-22-phase-1-sensor-label-harmonization.md'),
    path.resolve(__dirname, '../../../docs/superpowers/plans/2026-08-22-phase-1-sensor-label-harmonization.md'),
  ]

  const obsoletePatterns = [
    /S-03\s*[-:|]\s*Coil Joint/i,
    /S-02\s*[-:|]\s*Outside Filler(?!\s*Wire)/i,
    /S-04\s*[-:|]\s*Inside Filler(?!\s*Wire)/i,
  ]

  for (const filePath of docFiles) {
    assert.ok(fs.existsSync(filePath), `Doc file ${filePath} must exist`)
    const content = fs.readFileSync(filePath, 'utf8')
    for (const pattern of obsoletePatterns) {
      assert.ok(
        !pattern.test(content),
        `Doc file ${path.basename(filePath)} contains obsolete legacy mapping matching ${pattern}`,
      )
    }
  }
})

test('database guide documents migrations 008 and 009', () => {
  const databaseGuidePath = path.resolve(__dirname, '../../database/README.md')
  const content = fs.readFileSync(databaseGuidePath, 'utf8')

  assert.match(content, /008_harmonize_plant_sensor_labels\.sql/)
  assert.match(content, /009_align_sensor_downtime_causes\.sql/)
  assert.match(content, /S-02 Inside Filler Wire/)
  assert.match(content, /S-04 Outside Filler Wire/)
  assert.match(content, /S-02 and S-04 downtime faults to `Consumable Shortage`/)
  assert.match(content, /S-03 faults remain `Pending Cause Review`/)
})
