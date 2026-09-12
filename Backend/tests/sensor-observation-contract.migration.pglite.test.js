const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const test = require('node:test')

async function database(t) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  const root = path.resolve(__dirname, '../database')
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(root, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Observation Admin', 'observation-admin', 'hash', id from roles where name='Admin'`)
  for (const name of fs.readdirSync(path.join(root, 'migrations')).sort()) {
    if (/^(029|030|031|032|033|034|035|036|037|038|039|040|041)_.*\.sql$/.test(name)) {
      await db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
    }
  }
  return db
}

test('reconnect starts absence measurement at confirmed receipt without inventing activity', async (t) => {
  const db = await database(t)
  const boot = randomUUID()
  const heartbeat = async (sequence, id = randomUUID()) => (await db.query(`select r.* from sensors s
    cross join lateral ingest_iot_heartbeat($1,s.id,s.machine_id,1,$2,$3,'2026-08-21T00:00:00Z',false) r
    where sensor_code='S-03'`, [id, boot, sequence])).rows[0]
  await heartbeat(1)
  await db.query(`update sensor_watchdog_state set connectivity_state='offline', detection_state='suspended',
    absence_baseline_at=null, last_activity_received_at='2026-08-21T00:00:00Z',
    last_evaluated_at='2026-08-21T00:10:00Z' where sensor_id=(select id from sensors where sensor_code='S-03')`)
  assert.equal((await heartbeat(2)).connectivity_state, 'offline')
  const id = randomUUID()
  const confirmed = await heartbeat(3, id)
  assert.equal(confirmed.connectivity_state, 'online')
  const state = async () => (await db.query(`select w.* from sensor_watchdog_state w
    join sensors s on s.id=w.sensor_id where sensor_code='S-03'`)).rows[0]
  const before = await state()
  assert.deepEqual(before.absence_baseline_at, confirmed.received_at)
  assert.equal(before.last_activity_received_at.toISOString(), '2026-08-21T00:00:00.000Z')
  assert.equal((await heartbeat(3, id)).duplicate, true)
  assert.equal((await heartbeat(2)).stale, true)
  assert.deepEqual(await state(), before)
  await heartbeat(4)
  assert.deepEqual((await state()).absence_baseline_at, before.absence_baseline_at)
  const newBoot = await db.query(`select r.* from sensors s cross join lateral
    ingest_iot_heartbeat($1,s.id,s.machine_id,2,$2,1,'2026-08-21T00:00:00Z',false) r
    where sensor_code='S-03'`, [randomUUID(), randomUUID()])
  assert.deepEqual((await state()).absence_baseline_at, newBoot.rows[0].received_at)
  await db.query(`update sensors set status='Fault', fault_source='absence_watchdog' where sensor_code='S-03'`)
  await db.query(`update sensor_watchdog_state set detection_state='downtime'
    where sensor_id=(select id from sensors where sensor_code='S-03')`)
  const incident = await state()
  await db.query(`select r.* from sensors s cross join lateral
    ingest_iot_heartbeat($1,s.id,s.machine_id,3,$2,1,'2026-08-21T00:00:00Z',false) r
    where sensor_code='S-03'`, [randomUUID(), randomUUID()])
  assert.deepEqual((await state()).absence_baseline_at, incident.absence_baseline_at)
  assert.equal((await state()).detection_state, 'downtime')
  assert.equal((await db.query("select fault_source from sensors where sensor_code='S-03'")).rows[0].fault_source, 'absence_watchdog')
})

async function event(db, code, id, at, type = 'downtime', signal = 'no_pulse') {
  return (await db.query(`select r.* from sensors s cross join lateral
    ingest_iot_sensor_event($1,s.id,s.machine_id,$2,$3::jsonb,$4) r where sensor_code=$5`,
  [id, type, JSON.stringify({ signal }), at, code])).rows[0]
}

test('no-pulse events across all sensors remain observations and retries cannot advance runtime', async (t) => {
  const db = await database(t)
  for (const code of ['S-01', 'S-02', 'S-03', 'S-04', 'S-05']) {
    const id = randomUUID()
    const applied = await event(db, code, id, '2026-09-08T00:00:02Z')
    assert.equal(applied.state_applied, true)
    assert.equal(applied.downtime_id, null)
    assert.deepEqual(applied.transition_descriptors, [])
    const before = (await db.query(`select w.* from sensor_watchdog_state w
      join sensors s on s.id=w.sensor_id where s.sensor_code=$1`, [code])).rows
    assert.equal((await event(db, code, id, '2026-09-08T00:00:02Z')).duplicate, true)
    const stale = await event(db, code, randomUUID(), '2026-09-08T00:00:01Z', 'recovered', 'active')
    assert.equal(stale.stale, true)
    assert.equal(stale.state_applied, false)
    const after = (await db.query(`select w.* from sensor_watchdog_state w
      join sensors s on s.id=w.sensor_id where s.sensor_code=$1`, [code])).rows
    assert.deepEqual(after, before)
    assert.equal(after[0].last_activity_received_at, null)
    await assert.rejects(event(db, code, id, '2026-09-08T00:00:03Z'), { code: '22023' })
  }
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int n from alerts')).rows[0].n, 0)
  assert.equal((await db.query("select count(*)::int n from sensors where status='Fault'")).rows[0].n, 0)
})

test('heartbeat without activity updates connectivity evidence without inventing material activity', async (t) => {
  const db = await database(t)
  const id = randomUUID()
  const boot = randomUUID()
  const args = [id, boot]
  const sql = `select r.* from sensors s cross join lateral
    ingest_iot_heartbeat($1,s.id,s.machine_id,1,$2,1,'2026-09-08T00:00:00Z',false) r
    where sensor_code='S-01'`
  assert.equal((await db.query(sql, args)).rows[0].state_applied, true)
  assert.equal((await db.query(sql, args)).rows[0].duplicate, true)
  const { rows: [state] } = await db.query(`select w.* from sensor_watchdog_state w
    join sensors s on s.id=w.sensor_id where s.sensor_code='S-01'`)
  assert.ok(state.last_heartbeat_received_at)
  assert.equal(state.last_activity_received_at, null)
  assert.equal(state.recovery_observation_count, 0)
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
})
