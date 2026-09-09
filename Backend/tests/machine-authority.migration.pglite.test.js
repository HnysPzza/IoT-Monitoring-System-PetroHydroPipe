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
    select 'Authority Admin', 'authority-admin', 'hash', id from roles where name='Admin'`)
  for (const name of fs.readdirSync(path.join(root, 'migrations')).sort()) {
    if (/^(029|030|031|032|033|034|035|036|037|038|039|040)_.*\.sql$/.test(name)) {
      await db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
    }
  }
  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  settings.sensor_thresholds['S-03'] = { absenceDetectionEnabled: true, triggerSeconds: 60, recoverySeconds: 30 }
  await db.query('select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)])
  await db.query(`update sensor_watchdog_state set last_heartbeat_id=gen_random_uuid(),
    last_heartbeat_payload_hash='authority-fixture', last_heartbeat_received_at='2026-08-21T00:00:00Z',
    last_activity_received_at='2026-08-21T00:00:00Z', connectivity_state='online'`)
  return db
}

async function event(db, code, type, at, id = randomUUID()) {
  const signal = type === 'fault' ? 'fault' : type === 'idle' ? 'idle' : 'active'
  return (await db.query(`select r.* from sensors s cross join lateral
    ingest_iot_sensor_event($1,s.id,s.machine_id,$2,$3::jsonb,$4) r where sensor_code=$5`,
  [id, type, JSON.stringify({ signal }), at, code])).rows[0]
}

async function evaluate(db, at) {
  return (await db.query(`select r.* from sensors s cross join lateral
    evaluate_sensor_watchdog(s.id,$1,'enforce',300) r where sensor_code='S-03'`, [at])).rows[0]
}

async function machine(db) {
  return (await db.query('select status from machines')).rows[0].status
}

test('break start, break end and grace end preserve exact absence boundaries', async (t) => {
  const db = await database(t)
  await db.query(`update sensor_watchdog_state set last_activity_received_at='2026-08-21T01:59:30Z',
    absence_baseline_at='2026-08-21T01:59:30Z' where sensor_id=(select id from sensors where sensor_code='S-03')`)
  for (const [time, expected] of [
    ['01:59:59', 'grace'], ['02:00:00', 'suspended'], ['02:15:00', 'suspended'],
    ['02:24:59', 'suspended'], ['02:25:00', 'healthy'], ['02:25:59', 'grace'], ['02:26:00', 'downtime'],
  ]) {
    const at = `2026-08-21T${time}Z`
    await db.query(`update sensor_watchdog_state set last_heartbeat_received_at=$1
      where sensor_id=(select id from sensors where sensor_code='S-03')`, [at])
    assert.equal((await evaluate(db, at)).detection_state, expected, time)
  }
  const rows = (await db.query('select started_at from downtime_events')).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T02:26:00.000Z')
})

test('break and offline suspension keep an existing incident and reset recovery confirmation', async (t) => {
  const db = await database(t)
  await evaluate(db, '2026-08-21T00:01:00Z')
  const observe = async (at) => db.query(`update sensor_watchdog_state set last_activity_received_at=$1,
    last_heartbeat_received_at=$1 where sensor_id=(select id from sensors where sensor_code='S-03')`, [at])
  await observe('2026-08-21T01:59:50Z')
  await observe('2026-08-21T01:59:55Z')
  await evaluate(db, '2026-08-21T02:00:00Z')
  assert.equal(await machine(db), 'Downtime')
  const state = async () => (await db.query(`select w.* from sensor_watchdog_state w
    join sensors s on s.id=w.sensor_id where sensor_code='S-03'`)).rows[0]
  assert.equal((await state()).recovery_observation_count, 0)
  await observe('2026-08-21T02:25:00Z')
  await evaluate(db, '2026-08-21T02:25:30Z')
  assert.equal(await machine(db), 'Downtime')
  await observe('2026-08-21T02:25:31Z')
  await evaluate(db, '2026-08-21T02:31:00Z')
  assert.equal((await state()).connectivity_state, 'offline')
  assert.equal((await state()).recovery_observation_count, 0)
  assert.equal(await machine(db), 'Downtime')
  assert.equal((await db.query("select count(*)::int n from downtime_events where status='Open'")).rows[0].n, 1)
})

test('S-03 idle keeps the machine Idle despite active process and output sensors', async (t) => {
  const db = await database(t)
  await event(db, 'S-03', 'idle', '2026-08-21T00:00:01Z')
  assert.equal(await machine(db), 'Idle')
  for (const code of ['S-01', 'S-02', 'S-04', 'S-05']) {
    await event(db, code, 'pulse', '2026-08-21T00:00:02Z')
    assert.equal(await machine(db), 'Idle')
  }
  await event(db, 'S-03', 'pulse', '2026-08-21T00:00:03Z')
  assert.equal(await machine(db), 'Running')
})

test('S-03 short absence is Idle and confirmed absence opens one interval at the crossing', async (t) => {
  const db = await database(t)
  await evaluate(db, '2026-08-21T00:00:59Z')
  assert.equal(await machine(db), 'Idle')
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
  await evaluate(db, '2026-08-21T00:02:00Z')
  await evaluate(db, '2026-08-21T00:02:01Z')
  assert.equal(await machine(db), 'Downtime')
  const { rows } = await db.query('select started_at from downtime_events')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T00:01:00.000Z')
})

test('fresh S-03 activity refreshes watchdog evidence after a short stop', async (t) => {
  const db = await database(t)
  await evaluate(db, '2026-08-21T00:00:59Z')
  await event(db, 'S-03', 'pulse', '2026-08-21T00:01:00Z')
  const { rows: [state] } = await db.query(`select last_activity_received_at from sensor_watchdog_state
    where sensor_id=(select id from sensors where sensor_code='S-03')`)
  assert.ok(state.last_activity_received_at > new Date('2026-08-21T00:00:00Z'))
  assert.equal(await machine(db), 'Running')
})

for (const firstRecovery of ['S-01', 'S-03']) {
  test(`overlapping causes retain one S-03 interval when ${firstRecovery} recovers first`, async (t) => {
    const db = await database(t)
    for (const code of ['S-01', 'S-04']) await event(db, code, 'fault', '2026-08-21T00:01:00Z')
    assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
    await event(db, 'S-02', 'fault', '2026-08-21T00:02:00Z')
    assert.equal(await machine(db), 'Downtime')
    const { rows: [opened] } = await db.query('select id, started_at from downtime_events')
    assert.equal(opened.started_at.toISOString(), '2026-08-21T00:02:00.000Z')
    assert.equal((await db.query("select status from sensors where sensor_code='S-03'")).rows[0].status, 'Active')
    const faultId = randomUUID()
    await event(db, 'S-03', 'fault', '2026-08-21T00:03:00Z', faultId)
    assert.equal((await event(db, 'S-03', 'fault', '2026-08-21T00:03:00Z', faultId)).duplicate, true)
    assert.equal((await event(db, 'S-03', 'recovered', '2026-08-21T00:02:59Z')).stale, true)
    await event(db, 'S-05', 'pulse', '2026-08-21T00:03:01Z')
    assert.equal(await machine(db), 'Downtime')
    const alert = async () => (await db.query(`select a.metadata from alerts a join sensors s on s.id=a.sensor_id
      where s.sensor_code='S-03' and a.source_type='sensor'`)).rows[0].metadata
    assert.deepEqual((await alert()).currentContributingSensors, ['S-03'])
    assert.deepEqual((await alert()).contributingSensors, ['S-01', 'S-02', 'S-04'])
    await event(db, firstRecovery, 'recovered', '2026-08-21T00:04:00Z')
    assert.equal(await machine(db), 'Downtime')
    const remaining = firstRecovery === 'S-03' ? ['S-01', 'S-02', 'S-04'] : ['S-03']
    assert.deepEqual((await alert()).currentContributingSensors, remaining)
    await event(db, firstRecovery === 'S-03' ? 'S-01' : 'S-03', 'recovered', '2026-08-21T00:05:00Z')
    assert.equal(await machine(db), 'Running')
    const { rows } = await db.query('select id, ended_at from downtime_events')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, opened.id)
    assert.equal(rows[0].ended_at.toISOString(), '2026-08-21T00:05:00.000Z')
  })
}

test('a failed downtime audit rolls back the event, sensor, alert and machine transition', async (t) => {
  const db = await database(t)
  const before = await machine(db)
  await db.exec(`create function fail_authority_audit() returns trigger language plpgsql as $$
    begin if new.action='DOWNTIME_CREATED' then raise exception 'injected downtime audit failure'; end if;
    return new; end $$;
    create trigger fail_authority_audit before insert on audit_logs for each row execute function fail_authority_audit();`)
  await assert.rejects(event(db, 'S-03', 'fault', '2026-08-21T00:01:00Z'), /injected downtime audit failure/)
  assert.equal(await machine(db), before)
  assert.equal((await db.query("select status from sensors where sensor_code='S-03'")).rows[0].status, 'Active')
  for (const table of ['sensor_events', 'alerts', 'downtime_events']) {
    assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0)
  }
})

test('S-03 communication-only heartbeats cannot indefinitely delay its absence threshold', async (t) => {
  const db = await database(t)
  await db.query(`update sensor_watchdog_state set last_activity_received_at=null
    where sensor_id=(select id from sensors where sensor_code='S-03')`)
  await evaluate(db, '2026-08-21T00:00:30Z')
  await db.query(`update sensor_watchdog_state set last_heartbeat_received_at='2026-08-21T00:00:40Z'
    where sensor_id=(select id from sensors where sensor_code='S-03')`)
  await evaluate(db, '2026-08-21T00:01:00Z')
  assert.equal(await machine(db), 'Downtime')
})

test('S-03 watchdog recovery requires confirmation and keeps downtime until recovery duration completes', async (t) => {
  const db = await database(t)
  await evaluate(db, '2026-08-21T00:01:00Z')
  await event(db, 'S-03', 'pulse', '2026-08-21T00:01:01Z')
  assert.equal(await machine(db), 'Downtime')
  await event(db, 'S-05', 'pulse', '2026-08-21T00:01:02Z')
  assert.equal(await machine(db), 'Downtime')
  await db.exec('alter table sensor_watchdog_state disable trigger track_watchdog_recovery_observation')
  await db.query(`update sensor_watchdog_state set recovery_started_at='2026-08-21T00:01:05Z',
    last_activity_received_at='2026-08-21T00:01:10Z',recovery_observation_count=2
    where sensor_id=(select id from sensors where sensor_code='S-03')`)
  await db.exec('alter table sensor_watchdog_state enable trigger track_watchdog_recovery_observation')
  await evaluate(db, '2026-08-21T00:01:34Z')
  assert.equal(await machine(db), 'Downtime')
  await evaluate(db, '2026-08-21T00:01:35Z')
  assert.equal(await machine(db), 'Running')
  assert.equal((await db.query("select count(*)::int n from downtime_events where status='Open'")).rows[0].n, 0)
})

test('migration 038 is repeatable and healthy S-03 evidence restores Idle to Running', async (t) => {
  const db = await database(t)
  await db.exec(fs.readFileSync(path.join(root, 'migrations/038_s03_machine_authority.sql'), 'utf8'))
  await evaluate(db, '2026-08-21T00:00:59Z')
  await db.query(`update sensor_watchdog_state set last_activity_received_at='2026-08-21T00:01:00Z'
    where sensor_id=(select id from sensors where sensor_code='S-03')`)
  await evaluate(db, '2026-08-21T00:01:00Z')
  assert.equal(await machine(db), 'Running')
  const { rows: [permissions] } = await db.query(`select
    has_function_privilege('authenticated','reconcile_machine_downtime(uuid,timestamptz,text,text,jsonb)','execute') as client,
    has_function_privilege('service_role','evaluate_sensor_watchdog(uuid,timestamptz,text,integer)','execute') as service,
    has_function_privilege('service_role','evaluate_sensor_watchdog_legacy(uuid,timestamptz,text,integer)','execute') as legacy`)
  assert.deepEqual(permissions, { client: false, service: true, legacy: false })
})
