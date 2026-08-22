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
    path.resolve(__dirname, '../../../docs/ForUrgentWork/Plan/2026-08-22-phase-2-settings-storage-and-backend-api.md'),
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

test('database guide documents migrations 008 through 010', () => {
  const databaseGuidePath = path.resolve(__dirname, '../../database/README.md')
  const content = fs.readFileSync(databaseGuidePath, 'utf8')

  assert.match(content, /008_harmonize_plant_sensor_labels\.sql/)
  assert.match(content, /009_align_sensor_downtime_causes\.sql/)
  assert.match(content, /010_create_machine_operational_settings\.sql/)
  assert.match(content, /S-02 Inside Filler Wire/)
  assert.match(content, /S-04 Outside Filler Wire/)
  assert.match(content, /S-02 and S-04 downtime faults to `Consumable Shortage`/)
  assert.match(content, /S-03 faults remain `Pending Cause Review`/)
  assert.match(content, /update_machine_operational_settings/)
})

test('Phase 2 documents preserve the approved machine-settings boundary', () => {
  const phaseTwoPlanPath = path.resolve(
    __dirname,
    '../../../docs/ForUrgentWork/Plan/2026-08-22-phase-2-settings-storage-and-backend-api.md',
  )
  const phasePlanPath = path.resolve(__dirname, '../../../docs/phase plan.md')
  const configurePath = path.resolve(__dirname, '../../../docs/ForUrgentWork/Configure.md')
  const architecturePath = path.resolve(__dirname, '../../../docs/ARCHITECTURE.md')
  const prdPath = path.resolve(__dirname, '../../../docs/PRD.md')
  const tddPath = path.resolve(__dirname, '../../../docs/TDD.md')
  const phaseTwoPlan = fs.readFileSync(phaseTwoPlanPath, 'utf8')
  const phasePlan = fs.readFileSync(phasePlanPath, 'utf8')
  const configure = fs.readFileSync(configurePath, 'utf8')
  const architecture = fs.readFileSync(architecturePath, 'utf8')
  const prd = fs.readFileSync(prdPath, 'utf8')
  const tdd = fs.readFileSync(tddPath, 'utf8')

  for (const content of [phaseTwoPlan, phasePlan, configure, architecture]) {
    assert.match(content, /machine_operational_settings/)
    assert.match(content, /cannot detect an event that never arrives/i)
  }

  assert.match(phaseTwoPlan, /GET `\/api\/machines\/:machineId\/settings`/)
  assert.match(phaseTwoPlan, /PATCH `\/api\/machines\/:machineId\/settings`/)
  assert.match(phaseTwoPlan, /optimistic concurrency/i)
  assert.match(phaseTwoPlan, /audit.*roll back together/i)
  assert.match(phaseTwoPlan, /Production targets.*outside Phase 2/i)
  assert.match(phaseTwoPlan, /Status: Implemented/i)
  assert.match(phaseTwoPlan, /"workStart": "08:00"/)
  assert.match(phaseTwoPlan, /"rampUpGraceMinutes": 10/)
  assert.match(phasePlan, /Phase 2: Settings Storage & Backend API \(implemented\)/)
  assert.match(configure, /S-05.*Permanently disabled for absence detection/i)
  assert.match(configure, /production-target management separate/i)
  assert.match(prd, /production-target editing.*not part of Phase 2/i)
  assert.match(tdd, /Phase 2 storage\/API is complete/i)

  for (const content of [phasePlan, configure, architecture, prd, tdd]) {
    assert.doesNotMatch(content, /Phase 2.*global.*system_settings/i)
  }
})
