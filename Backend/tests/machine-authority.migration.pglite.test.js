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
    if (/^(029|030|031|032|033|034|035|036|037|038)_.*\.sql$/.test(name)) {
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
