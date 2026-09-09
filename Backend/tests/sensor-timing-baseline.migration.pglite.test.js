const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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
    select 'Timing Admin', 'timing-admin', 'hash', id from roles where name='Admin'`)
  for (const name of fs.readdirSync(path.join(root, 'migrations')).sort()) {
    if (/^(029|030|031|032|033|034|035|036|037)_.*\.sql$/.test(name)) {
      await db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
    }
  }
  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  settings.sensor_thresholds['S-03'] = {
    absenceDetectionEnabled: true, triggerSeconds: 60, recoverySeconds: 30,
  }
  await db.query('select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)])
  await db.query(`update sensor_watchdog_state set
    last_heartbeat_id=gen_random_uuid(), last_heartbeat_payload_hash='timing-fixture',
    last_heartbeat_received_at='2026-08-21T00:00:00Z',
    last_activity_received_at='2026-08-21T00:00:00Z', connectivity_state='online'
    where sensor_id=(select id from sensors where sensor_code='S-03')`)
  return db
}

async function evaluate(db, at, mode = 'enforce') {
  return (await db.query(`select r.* from sensors s cross join lateral
    evaluate_sensor_watchdog(s.id,$1,$2,300) r where s.sensor_code='S-03'`, [at, mode])).rows[0]
}

test('S-03 opens once at exactly 60 eligible seconds, never at 59 seconds', async (t) => {
  const db = await database(t)
  await db.exec(fs.readFileSync(path.join(root, 'migrations/036_preserve_direct_watchdog_threshold_time.sql'), 'utf8'))
  assert.equal((await evaluate(db, '2026-08-21T00:00:59Z')).detection_state, 'grace')
  assert.equal((await db.query('select count(*)::int n from downtime_events')).rows[0].n, 0)
  assert.equal((await evaluate(db, '2026-08-21T00:01:00Z')).detection_state, 'downtime')
  await evaluate(db, '2026-08-21T00:01:01Z')
  await evaluate(db, '2026-08-21T00:01:01Z')
  const { rows } = await db.query(`select d.started_at, s.sensor_code
    from downtime_events d join sensors s on s.id=d.sensor_id`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sensor_code, 'S-03')
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T00:01:00.000Z')
})

test('late watchdog evaluation records threshold crossing instead of evaluation time', async (t) => {
  const db = await database(t)
  await evaluate(db, '2026-08-21T00:02:00Z')
  await evaluate(db, '2026-08-21T00:02:01Z')
  const { rows } = await db.query('select started_at from downtime_events')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T00:01:00.000Z')
})

test('observe mode reaching the threshold leaves operational state and alerts unchanged', async (t) => {
  const db = await database(t)
  assert.equal((await evaluate(db, '2026-08-21T00:01:00Z', 'observe')).detection_state, 'downtime')
  const { rows: [state] } = await db.query(`select
    (select count(*)::int from downtime_events) as downtime,
    (select count(*)::int from alerts) as alerts,
    (select status from sensors where sensor_code='S-03') as status`)
  assert.deepEqual(state, { downtime: 0, alerts: 0, status: 'Active' })
})

for (const codes of [['S-03'], ['S-01', 'S-04', 'S-02']]) {
  test(`migration 036 preserves explicit ${codes.join('/')} ownership and recovery`, async (t) => {
    const db = await database(t)
    for (const code of codes) {
      await db.query(`select r.* from sensors s cross join lateral
        ingest_iot_sensor_event(gen_random_uuid(),s.id,s.machine_id,'fault',
          '{"signal":"fault"}'::jsonb,'2026-08-21T00:02:00Z') r where sensor_code=$1`, [code])
    }
    const { rows } = await db.query(`select d.started_at,s.sensor_code from downtime_events d
      join sensors s on s.id=d.sensor_id where d.status='Open'`)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].sensor_code, 'S-03')
    assert.equal(rows[0].started_at.toISOString(), '2026-08-21T00:02:00.000Z')
    await db.query(`select r.* from sensors s cross join lateral
      ingest_iot_sensor_event(gen_random_uuid(),s.id,s.machine_id,'recovered',
        '{"signal":"active"}'::jsonb,'2026-08-21T00:03:00Z') r where sensor_code=$1`, [codes[0]])
    assert.equal((await db.query("select count(*)::int n from downtime_events where status='Open'")).rows[0].n, 0)
    const { rows: [permissions] } = await db.query(`select
      has_function_privilege('authenticated','evaluate_sensor_watchdog(uuid,timestamptz,text,integer)','execute') as client,
      has_function_privilege('service_role','evaluate_sensor_watchdog(uuid,timestamptz,text,integer)','execute') as service`)
    assert.deepEqual(permissions, { client: false, service: true })
  })
}
