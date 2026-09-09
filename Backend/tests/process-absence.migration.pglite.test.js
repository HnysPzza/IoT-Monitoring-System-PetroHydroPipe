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
    if (/^(029|030|031|032|033|034|035|036|037|038)_.*\.sql$/.test(name)) {
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
    await event(db, code, 'pulse', 'active', '2026-08-21T00:01:02Z')
    assert.equal((await sensor(db, code)).status, 'Fault')
    await event(db, code, 'idle', 'idle', '2026-08-21T00:01:03Z')
    assert.equal((await sensor(db, code)).status, 'Fault')
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

test('fresh process activity resets absence evidence, while duplicate and stale activity do not', async (t) => {
  const db = await database(t)
  for (const code of ['S-01', 'S-02', 'S-04']) {
    await evaluate(db, code, '2026-08-21T00:00:59Z')
    const id = randomUUID()
    await event(db, code, 'pulse', 'active', '2026-08-21T00:01:00Z', id)
    const runtime = async () => (await db.query(`select w.last_activity_received_at from sensor_watchdog_state w
      join sensors s on s.id=w.sensor_id where sensor_code=$1`, [code])).rows[0]
    const applied = await runtime()
    assert.ok(applied.last_activity_received_at > new Date('2026-08-21T00:00:00Z'))
    assert.equal((await sensor(db, code)).status, 'Active')
    await event(db, code, 'pulse', 'active', '2026-08-21T00:01:00Z', id)
    await event(db, code, 'pulse', 'active', '2026-08-21T00:00:58Z')
    assert.deepEqual(await runtime(), applied)
  }
})

test('confirmed healthy activity returns a process sensor from grace Idle to Active', async (t) => {
  const db = await database(t)
  await evaluate(db, 'S-01', '2026-08-21T00:00:59Z')
  await db.query(`update sensor_watchdog_state set last_activity_received_at='2026-08-21T00:01:00Z'
    where sensor_id=(select id from sensors where sensor_code='S-01')`)
  assert.equal((await evaluate(db, 'S-01', '2026-08-21T00:01:00Z')).detection_state, 'healthy')
  assert.equal((await sensor(db, 'S-01')).status, 'Active')
})

test('explicit process fault survives grace, healthy activity evidence and offline suspension', async (t) => {
  const db = await database(t)
  await event(db, 'S-01', 'fault', 'fault', '2026-08-21T00:00:01Z')
  await evaluate(db, 'S-01', '2026-08-21T00:00:59Z')
  assert.deepEqual(await sensor(db, 'S-01'), { status: 'Fault', fault_source: 'explicit' })
  await db.query(`update sensor_watchdog_state set last_activity_received_at='2026-08-21T00:01:00Z'
    where sensor_id=(select id from sensors where sensor_code='S-01')`)
  await evaluate(db, 'S-01', '2026-08-21T00:01:00Z')
  await evaluate(db, 'S-01', '2026-08-21T00:10:00Z')
  assert.deepEqual(await sensor(db, 'S-01'), { status: 'Fault', fault_source: 'explicit' })
})

test('process fault audit failure rolls back state and alert together', async (t) => {
  const db = await database(t)
  await evaluate(db, 'S-01', '2026-08-21T00:00:59Z')
  await db.exec(`create function reject_process_audit() returns trigger language plpgsql as $$
    begin if new.action='ALERT_CREATED' then raise exception 'injected process audit failure'; end if;
    return new; end $$;
    create trigger reject_process_audit before insert on audit_logs
    for each row execute function reject_process_audit();`)
  await assert.rejects(evaluate(db, 'S-01', '2026-08-21T00:01:00Z'), /injected process audit failure/)
  assert.deepEqual(await sensor(db, 'S-01'), { status: 'Inactive', fault_source: null })
  assert.equal((await db.query('select count(*)::int n from alerts')).rows[0].n, 0)
  const { rows: [state] } = await db.query(`select detection_state from sensor_watchdog_state
    where sensor_id=(select id from sensors where sensor_code='S-01')`)
  assert.equal(state.detection_state, 'grace')
})

test('migration reapplication preserves the process group and RPC access boundaries', async (t) => {
  const db = await database(t)
  await db.exec(fs.readFileSync(path.join(root, 'migrations/037_process_absence_idle.sql'), 'utf8'))
  for (const code of ['S-01', 'S-04', 'S-02']) await evaluate(db, code, '2026-08-21T00:01:00Z')
  const { rows } = await db.query(`select s.sensor_code from downtime_events d
    join sensors s on s.id=d.sensor_id where d.status='Open'`)
  assert.deepEqual(rows, [{ sensor_code: 'S-03' }])
  assert.equal((await sensor(db, 'S-03')).status, 'Active')
  const { rows: [permissions] } = await db.query(`select
    has_function_privilege('authenticated','evaluate_sensor_watchdog(uuid,timestamptz,text,integer)','execute') as client,
    has_function_privilege('service_role','evaluate_sensor_watchdog(uuid,timestamptz,text,integer)','execute') as service`)
  assert.deepEqual(permissions, { client: false, service: true })
})

test('heartbeats without activity cannot restart an established process absence timer', async (t) => {
  const db = await database(t)
  await db.query(`update sensor_watchdog_state set last_activity_received_at=null
    where sensor_id=(select id from sensors where sensor_code='S-01')`)
  await evaluate(db, 'S-01', '2026-08-21T00:00:30Z')
  await db.query(`update sensor_watchdog_state set last_heartbeat_received_at='2026-08-21T00:00:40Z'
    where sensor_id=(select id from sensors where sensor_code='S-01')`)
  await evaluate(db, 'S-01', '2026-08-21T00:01:00Z')
  assert.deepEqual(await sensor(db, 'S-01'), { status: 'Fault', fault_source: 'absence_watchdog' })
})

test('process sensors honor independent configured thresholds', async (t) => {
  const db = await database(t)
  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  settings.sensor_thresholds['S-02'].triggerSeconds = 120
  await db.query('select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)])
  await evaluate(db, 'S-01', '2026-08-21T00:01:00Z')
  await evaluate(db, 'S-02', '2026-08-21T00:01:00Z')
  assert.equal((await sensor(db, 'S-01')).status, 'Fault')
  assert.equal((await sensor(db, 'S-02')).status, 'Inactive')
  await evaluate(db, 'S-02', '2026-08-21T00:02:00Z')
  assert.equal((await sensor(db, 'S-02')).status, 'Fault')
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
})
