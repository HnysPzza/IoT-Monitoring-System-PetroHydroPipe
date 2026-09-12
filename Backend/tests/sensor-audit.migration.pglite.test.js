const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const test = require('node:test')
const root = path.resolve(__dirname, '../database')
const baseSchema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8')
const migrations = [
  '029_account_onboarding.sql',
  '030_verify_login_credentials.sql',
  '031_atomic_login_audit.sql',
  '032_grouped_downtime_rule.sql',
  '033_repair_grouped_downtime_dispatch.sql',
  '034_route_output_telemetry_through_grouped_reconciliation.sql',
  '035_fix_sensor_audit.sql',
]
  .map((name) => fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))

async function database(t) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(baseSchema)
  await db.exec(fs.readFileSync(path.join(root, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Migration Admin', 'migration-admin', 'hash', id from roles where name = 'Admin'`)
  for (const migration of migrations) await db.exec(migration)
  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  for (const code of ['S-01', 'S-02', 'S-03', 'S-04']) {
    settings.sensor_thresholds[code] = { absenceDetectionEnabled: true, triggerSeconds: 60, recoverySeconds: 30 }
  }
  await db.query('select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)])
  return db
}

async function event(db, code, type, at) {
  return (await db.query(`select r.* from sensors s cross join lateral
    ingest_iot_sensor_event($1,s.id,s.machine_id,$2,$3::jsonb,$4) r where sensor_code=$5`,
  [randomUUID(), type, JSON.stringify({ signal: type === 'fault' ? 'fault' : 'active' }), at, code])).rows[0]
}

async function state(db, code, activity, recoveryStart = null, count = 0) {
  await db.exec('alter table sensor_watchdog_state disable trigger track_watchdog_recovery_observation')
  await db.query(`update sensor_watchdog_state set connectivity_state='online',
    boot_counter=1,boot_id=gen_random_uuid(),last_sequence=1,
    last_heartbeat_id=gen_random_uuid(),last_heartbeat_payload_hash='test',
    last_heartbeat_received_at='2026-08-21T00:02:49Z', last_activity_received_at=$2,
    recovery_started_at=$3,recovery_observation_count=$4
    where sensor_id=(select id from sensors where sensor_code=$1)`, [code, activity, recoveryStart, count])
  await db.exec('alter table sensor_watchdog_state enable trigger track_watchdog_recovery_observation')
}

async function evaluate(db, code, at = '2026-08-21T00:02:50Z') {
  return (await db.query(`select r.* from sensors s cross join lateral
    evaluate_sensor_watchdog(s.id,$2,'enforce',300) r where sensor_code=$1`, [code, at])).rows[0]
}

test('F01 grouped downtime never creates a healthy S-03 physical fault', async (t) => {
  const db = await database(t)
  for (const code of ['S-01', 'S-02', 'S-04']) await event(db, code, 'fault', '2026-08-21T00:02:00Z')
  await state(db, 'S-03', '2026-08-21T00:02:49Z')
  await evaluate(db, 'S-03')
  assert.equal((await db.query("select status from sensors where sensor_code='S-03'")).rows[0].status, 'Active')
  const recovery = await event(db, 'S-01', 'recovered', '2026-08-21T00:02:51Z')
  assert.equal(recovery.downtime_action, 'resolved')
})

for (const code of ['S-01', 'S-02', 'S-03', 'S-04']) {
  test(`F01 ${code} watchdog recovery needs two observations and the full duration`, async (t) => {
    const db = await database(t)
    await state(db, code, '2026-08-21T00:00:00Z')
    await evaluate(db, code, '2026-08-21T00:02:00Z')
    await state(db, code, '2026-08-21T00:02:10Z', '2026-08-21T00:02:05Z', 1)
    await evaluate(db, code)
    assert.equal((await db.query('select status from sensors where sensor_code=$1', [code])).rows[0].status, 'Fault')
    await state(db, code, '2026-08-21T00:02:10Z', '2026-08-21T00:02:05Z', 2)
    await evaluate(db, code, '2026-08-21T00:02:34Z')
    assert.equal((await db.query('select status from sensors where sensor_code=$1', [code])).rows[0].status, 'Fault')
    const result = await evaluate(db, code)
    assert.equal(result.detection_state, 'healthy')
    assert.equal((await db.query('select status from sensors where sensor_code=$1', [code])).rows[0].status, 'Active')
    assert.equal((await db.query('select detection_state from sensor_watchdog_state where sensor_id=(select id from sensors where sensor_code=$1)', [code])).rows[0].detection_state, 'healthy')
  })
}

test('F01 review preserves offline faults, observe-only state, and S-05 isolation', async (t) => {
  const db = await database(t)
  await state(db, 'S-01', '2026-08-21T00:00:00Z')
  await db.query("select evaluate_sensor_watchdog(id,'2026-08-21T00:02:00Z','observe',300) from sensors where sensor_code='S-01'")
  assert.equal((await db.query("select status from sensors where sensor_code='S-01'")).rows[0].status, 'Active')
  await evaluate(db, 'S-01')
  await state(db, 'S-01', '2026-08-21T00:02:10Z', '2026-08-21T00:02:05Z', 2)
  await evaluate(db, 'S-01', '2026-08-21T00:10:00Z')
  assert.equal((await db.query("select status from sensors where sensor_code='S-01'")).rows[0].status, 'Fault')
  await state(db, 'S-05', '2026-08-21T00:00:00Z')
  await evaluate(db, 'S-05')
  assert.equal((await db.query("select status from sensors where sensor_code='S-05'")).rows[0].status, 'Active')
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
  assert.equal((await db.query("select has_function_privilege('service_role','evaluate_sensor_watchdog_legacy(uuid,timestamptz,text,integer)','execute') allowed")).rows[0].allowed, false)
})

test('F02 explicit recovery supersedes older watchdog state without bypassing watchdog-owned recovery', async (t) => {
  const db = await database(t)
  await state(db, 'S-01', '2026-08-21T00:00:00Z')
  await evaluate(db, 'S-01')
  await event(db, 'S-01', 'fault', '2026-08-21T00:03:00Z')
  const stale = await event(db, 'S-01', 'recovered', '2026-08-21T00:02:59Z')
  assert.equal(stale.stale, true)
  assert.equal((await db.query("select status from sensors where sensor_code='S-01'")).rows[0].status, 'Fault')
  await event(db, 'S-01', 'recovered', '2026-08-21T00:03:01Z')
  assert.equal((await db.query("select status from sensors where sensor_code='S-01'")).rows[0].status, 'Active')
  assert.equal((await db.query("select detection_state from sensor_watchdog_state where sensor_id=(select id from sensors where sensor_code='S-01')")).rows[0].detection_state, 'healthy')
  await state(db, 'S-02', '2026-08-21T00:00:00Z')
  await evaluate(db, 'S-02')
  await event(db, 'S-02', 'recovered', '2026-08-21T00:03:01Z')
  assert.equal((await db.query("select status from sensors where sensor_code='S-02'")).rows[0].status, 'Fault')
})

test('migration 035 removes legacy downtime ownership from process alerts', async (t) => {
  const db = await database(t)
  await db.query(`insert into alerts (
    source_type, source_id, machine_id, sensor_id, severity, status, title, message, metadata
  ) select 'sensor', id, machine_id, id, 'Warning', 'Active', 'Legacy process alert',
    'Legacy process alert', '{"processFault":true,"downtimeId":"legacy-downtime"}'::jsonb
    from sensors where sensor_code='S-01'`)

  await db.exec(migrations.at(-1))

  const metadata = (await db.query(`select metadata from alerts alert
    join sensors sensor on sensor.id=alert.sensor_id where sensor.sensor_code='S-01'`)).rows[0].metadata
  assert.equal(metadata.processFault, true)
  assert.equal(metadata.downtimeId, undefined)
})

test('F08 missing authority rejects ingestion atomically and fails readiness', async (t) => {
  const db = await database(t)
  assert.equal((await db.query('select get_backend_readiness() as version')).rows[0].version, 35)
  await db.exec('set role anon')
  await assert.rejects(() => db.query('select get_backend_readiness()'), /permission denied/i)
  await db.exec('set role service_role')
  assert.equal((await db.query('select get_backend_readiness() as version')).rows[0].version, 35)
  await db.exec('reset role')
  await db.exec("delete from sensors where sensor_code='S-03'")
  await assert.rejects(() => event(db, 'S-01', 'fault', '2026-08-21T00:03:00Z'), /authority.*missing/i)
  assert.equal((await db.query('select count(*)::int n from sensor_events')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int n from alerts')).rows[0].n, 0)
  assert.equal((await db.query("select status from sensors where sensor_code='S-01'")).rows[0].status, 'Active')
  await assert.rejects(() => db.query('select get_backend_readiness()'), /sensor.*missing/i)
})
