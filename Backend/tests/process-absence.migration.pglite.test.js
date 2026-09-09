const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const test = require('node:test')
const root = path.resolve(__dirname, '../database')

async function database(t) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(root, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Process Admin', 'process-admin', 'hash', id from roles where name='Admin'`)
  for (const name of fs.readdirSync(path.join(root, 'migrations')).sort()) {
    if (/^(029|030|031|032|033|034|035|036|037)_.*\.sql$/.test(name)) {
      await db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
    }
  }
  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  for (const code of ['S-01', 'S-02', 'S-04']) {
    settings.sensor_thresholds[code] = { absenceDetectionEnabled: true, triggerSeconds: 60, recoverySeconds: 30 }
  }
  await db.query('select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)])
  await db.query(`update sensor_watchdog_state set last_heartbeat_id=gen_random_uuid(),
    last_heartbeat_payload_hash='process-fixture', last_heartbeat_received_at='2026-08-21T00:00:00Z',
    last_activity_received_at='2026-08-21T00:00:00Z', connectivity_state='online'`)
  return db
}

async function evaluate(db, code, at, mode = 'enforce') {
  return (await db.query(`select r.* from sensors s cross join lateral
    evaluate_sensor_watchdog(s.id,$2,$3,300) r where s.sensor_code=$1`, [code, at, mode])).rows[0]
}

async function event(db, code, type, signal, at, id = randomUUID()) {
  return (await db.query(`select r.* from sensors s cross join lateral
    ingest_iot_sensor_event($1,s.id,s.machine_id,$2,$3::jsonb,$4) r where sensor_code=$5`,
  [id, type, JSON.stringify({ signal }), at, code])).rows[0]
}

async function sensor(db, code) {
  return (await db.query('select status,fault_source from sensors where sensor_code=$1', [code])).rows[0]
}

for (const code of ['S-01', 'S-02', 'S-04']) {
  test(`${code} is Idle before threshold and one process Fault at threshold`, async (t) => {
    const db = await database(t)
    assert.equal((await evaluate(db, code, '2026-08-21T00:00:59Z')).detection_state, 'grace')
    assert.deepEqual(await sensor(db, code), { status: 'Inactive', fault_source: null })
    assert.equal((await db.query('select count(*)::int n from alerts')).rows[0].n, 0)
    await event(db, code, 'downtime', 'no_pulse', '2026-08-21T00:00:59Z')
    await evaluate(db, code, '2026-08-21T00:01:00Z')
    await evaluate(db, code, '2026-08-21T00:01:01Z')
    assert.deepEqual(await sensor(db, code), { status: 'Fault', fault_source: 'absence_watchdog' })
    const { rows } = await db.query("select severity, metadata from alerts where source_type='sensor'")
    assert.equal(rows.length, 1)
    assert.equal(rows[0].severity, 'Warning')
    assert.equal(rows[0].metadata.processFault, true)
    assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
    assert.notEqual((await db.query('select status from machines')).rows[0].status, 'Downtime')
  })
}

test('two outstanding process faults remain process-level and survive idle and S-03 stopping', async (t) => {
  const db = await database(t)
  for (const code of ['S-01', 'S-04']) await evaluate(db, code, '2026-08-21T00:01:00Z')
  await event(db, 'S-01', 'idle', 'idle', '2026-08-21T00:01:01Z')
  await event(db, 'S-03', 'idle', 'idle', '2026-08-21T00:01:02Z')
  await event(db, 'S-02', 'pulse', 'active', '2026-08-21T00:01:03Z')
  for (const code of ['S-01', 'S-04']) assert.equal((await sensor(db, code)).status, 'Fault')
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
})

test('observe and disabled modes do not change process operational state', async (t) => {
  const db = await database(t)
  await evaluate(db, 'S-01', '2026-08-21T00:00:59Z', 'observe')
  await evaluate(db, 'S-02', '2026-08-21T00:00:59Z', 'disabled')
  assert.equal((await sensor(db, 'S-01')).status, 'Active')
  assert.equal((await sensor(db, 'S-02')).status, 'Active')
})
