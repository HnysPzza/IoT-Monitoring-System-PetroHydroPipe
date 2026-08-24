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
    path.resolve(__dirname, '../../../docs/ForUrgentFix/Plans/phase 3.md'),
    path.resolve(__dirname, '../../../docs/ForUrgentFix/Plans/phase 4.md'),
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

test('database guide documents migrations 008 through 016', () => {
  const databaseGuidePath = path.resolve(__dirname, '../../database/README.md')
  const content = fs.readFileSync(databaseGuidePath, 'utf8')

  assert.match(content, /008_harmonize_plant_sensor_labels\.sql/)
  assert.match(content, /009_align_sensor_downtime_causes\.sql/)
  assert.match(content, /010_create_machine_operational_settings\.sql/)
  assert.match(content, /011_add_settings_history_and_watchdog_runtime\.sql/)
  assert.match(content, /012_add_atomic_watchdog_transitions\.sql/)
  assert.match(content, /013_fix_heartbeat_digest_schema\.sql/)
  assert.match(content, /014_add_batched_watchdog_evaluation\.sql/)
  assert.match(content, /015_add_live_monitoring_snapshot\.sql/)
  assert.match(content, /016_protect_base_tables\.sql/)
  assert.match(content, /S-02 Inside Filler Wire/)
  assert.match(content, /S-04 Outside Filler Wire/)
  assert.match(content, /S-02 and S-04 downtime faults to `Consumable Shortage`/)
  assert.match(content, /S-03 faults remain `Pending Cause Review`/)
  assert.match(content, /update_machine_operational_settings/)
  assert.match(content, /WATCHDOG_MODE=disabled/)
  assert.match(content, /POST \/api\/iot\/heartbeats/)
})

test('phase documents explain purpose, operation, importance, and implemented result', () => {
  const phaseDocuments = [
    path.resolve(__dirname, '../../../docs/ForUrgentWork/Plan/2026-08-22-phase-1-sensor-label-harmonization.md'),
    path.resolve(__dirname, '../../../docs/ForUrgentWork/Plan/2026-08-22-phase-2-settings-storage-and-backend-api.md'),
    path.resolve(__dirname, '../../../docs/ForUrgentFix/Plans/phase 3.md'),
    path.resolve(__dirname, '../../../docs/ForUrgentFix/Plans/phase 4.md'),
  ]

  for (const filePath of phaseDocuments) {
    const content = fs.readFileSync(filePath, 'utf8')
    assert.match(content, /^#{2,3} (?:\d+\. )?Purpose$/m)
    assert.match(content, /^#{2,3} How It Works$/m)
    assert.match(content, /^#{2,3} Importance$/m)
    assert.match(content, /^#{2,3} Implemented Result$/m)
  }
})

test('Phase 4 docs preserve the settings and live monitoring safety boundary', () => {
  const root = path.resolve(__dirname, '../../..')
  const plan = fs.readFileSync(path.join(root, 'docs/ForUrgentFix/Plans/phase 4.md'), 'utf8')
  const architecture = fs.readFileSync(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8')
  const configure = fs.readFileSync(path.join(root, 'docs/ForUrgentWork/Configure.md'), 'utf8')
  const runbook = fs.readFileSync(path.join(root, 'docs/RUNBOOK.md'), 'utf8')

  assert.match(plan, /Migration `015` must be applied/i)
  assert.match(plan, /S-05 remains locked/i)
  assert.match(plan, /one request every 15 seconds/i)
  assert.match(plan, /Production enforcement remains blocked/i)
  assert.match(architecture, /get_machine_live_snapshot/)
  assert.match(architecture, /Hidden tabs pause polling/i)
  assert.match(configure, /no mode-mutation API or UI control/i)
  assert.match(runbook, /Do not use enforce mode as a UI test/i)
})

test('Phase 3 operations docs preserve the safe activation boundary', () => {
  const root = path.resolve(__dirname, '../../..')
  const files = {
    environment: path.join(root, 'Backend/.env.example'),
    architecture: path.join(root, 'docs/ARCHITECTURE.md'),
    configure: path.join(root, 'docs/ForUrgentWork/Configure.md'),
    runbook: path.join(root, 'docs/RUNBOOK.md'),
    plan: path.join(root, 'docs/ForUrgentFix/Plans/phase 3.md'),
  }
  const docs = Object.fromEntries(
    Object.entries(files).map(([name, filePath]) => [name, fs.readFileSync(filePath, 'utf8')]),
  )

  assert.match(docs.environment, /WATCHDOG_MODE=disabled/)
  assert.match(docs.environment, /IOT_HEARTBEAT_EXPECTED_INTERVAL_MS=10000/)
  assert.match(docs.architecture, /Connectivity loss.*cannot create production downtime/i)
  assert.match(docs.architecture, /`GET \/api\/operations\/watchdog`/)
  assert.match(docs.configure, /Never enable S-05/i)
  assert.match(docs.configure, /separate approval before using `enforce`/i)
  assert.match(docs.configure, /periodic evaluation runner remains stopped/i)
  assert.match(docs.architecture, /one service-role-only database request/i)
  assert.match(docs.configure, /Do not deploy the completed backend until migrations `011`, `012`, `013`, and `014` are all applied/i)
  assert.match(docs.runbook, /Apply database migrations `011`, `012`, `013`, and `014` in numeric order/i)
  assert.match(docs.runbook, /Preserve settings history.*runtime\/transition evidence/i)
  assert.match(docs.plan, /Status: Backend implementation completed/i)
  assert.match(docs.plan, /Production enforcement is not active/i)
  assert.match(docs.plan, /evaluation runner does not start/i)
  assert.match(docs.plan, /Do not deploy the completed Phase 3 backend until migrations 011, 012, 013, and 014/i)
  assert.match(docs.plan, /cyclePartialFailures/)
  assert.match(docs.plan, /Backend full suite: `node --test --test-concurrency=2 tests\/\*\.test\.js tests\/contracts\/\*\.test\.js` - 224 passed, 0 failed/i)
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
