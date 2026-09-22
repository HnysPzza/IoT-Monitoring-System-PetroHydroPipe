const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../database')
const releaseMigrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
  .filter((name) => {
    const match = /^(\d{3})_.*\.sql$/.exec(name)
    return match && Number(match[1]) >= 29 && Number(match[1]) <= 44
  })
  .sort()
  .map((name) => fs.readFileSync(path.join(databaseRoot, 'migrations', name), 'utf8'))

async function database(t) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Threat 5 Admin', 'threat-5-admin', 'hash', id from roles where name = 'Admin'`)
  for (const migration of releaseMigrations) await db.exec(migration)
  return db
}

async function ingest(db, sensorCode, eventType, recordedAt) {
  const signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active'
  return (await db.query(`
    select result.*
    from sensors sensor
    cross join lateral ingest_iot_sensor_event(
      $1,
      sensor.id,
      sensor.machine_id,
      $2,
      $3::jsonb,
      $4
    ) result
    where sensor.sensor_code = $5
  `, [randomUUID(), eventType, JSON.stringify({ signal, metadata: {} }), recordedAt, sensorCode])).rows[0]
}

async function outputCount(db) {
  const { rows } = await db.query(`select coalesce(sum(event_count), 0)::bigint as count
    from aggregate_analytics_sensor_events(
      (select id from machines where machine_code='M-01'),
      '2026-08-21T16:00:00+08:00',
      '2026-08-21T17:00:00+08:00',
      3600
    )`)
  return Number(rows[0].count)
}

test('migration 044 is safe to reapply without changing the output contract', async (t) => {
  const db = await database(t)
  const migration = fs.readFileSync(
    path.join(databaseRoot, 'migrations', '044_validate_s05_output_pulses.sql'),
    'utf8',
  )

  await db.exec(migration)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 44)
  assert.equal((await db.query(`select count(*)::int as count
    from pg_constraint
    where conname='sensor_events_output_classification'`)).rows[0].count, 1)
})

test('S-05 pulse during S-03 idle is retained without applying output state', async (t) => {
  const db = await database(t)

  await ingest(db, 'S-03', 'idle', '2026-08-21T16:53:00+08:00')
  const outputPulse = await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')
  const stored = (await db.query(`select output_accepted, output_rejection_reason
    from sensor_events where id=$1`, [outputPulse.sensor_event_id])).rows[0]

  assert.equal(outputPulse.state_applied, false)
  assert.equal(outputPulse.event_value.metadata.outputAccepted, false)
  assert.equal(stored.output_accepted, false)
  assert.equal(stored.output_rejection_reason, 'machine_stationary')
})

test('rejected S-05 pulse does not advance its watermark or output total', async (t) => {
  const db = await database(t)

  await ingest(db, 'S-03', 'idle', '2026-08-21T16:53:00+08:00')
  await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')

  const { rows: [sensor] } = await db.query(`select last_applied_recorded_at
    from sensors where sensor_code='S-05'`)
  assert.equal(sensor.last_applied_recorded_at, null)
  assert.equal(await outputCount(db), 0)
  assert.equal((await db.query('select count(*)::int as count from downtime_events')).rows[0].count, 0)
})

test('valid S-05 pulse is accepted after S-03 activity', async (t) => {
  const db = await database(t)

  await ingest(db, 'S-03', 'pulse', '2026-08-21T16:53:00+08:00')
  const outputPulse = await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')

  assert.equal(outputPulse.state_applied, true)
  assert.equal(outputPulse.event_value.metadata.outputAccepted, true)
  assert.equal(await outputCount(db), 1)
})

test('S-05 pulse during S-03 downtime is retained but excluded', async (t) => {
  const db = await database(t)

  await ingest(db, 'S-03', 'fault', '2026-08-21T16:53:00+08:00')
  const outputPulse = await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')

  assert.equal(outputPulse.state_applied, false)
  assert.equal(outputPulse.event_value.metadata.outputRejectionReason, 'machine_downtime')
  assert.equal(await outputCount(db), 0)
})

test('rapid S-05 pulse is rejected without removing the prior accepted count', async (t) => {
  const db = await database(t)

  await ingest(db, 'S-03', 'pulse', '2026-08-21T16:53:00+08:00')
  await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00.000+08:00')
  const bounce = await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00.050+08:00')

  assert.equal(bounce.state_applied, false)
  assert.equal(bounce.event_value.metadata.outputRejectionReason, 'server_debounce')
  assert.equal(await outputCount(db), 1)
})

test('stale S-05 pulse is excluded with an explicit stale reason', async (t) => {
  const db = await database(t)

  await ingest(db, 'S-03', 'pulse', '2026-08-21T16:53:00+08:00')
  await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')
  const stale = await ingest(db, 'S-05', 'pulse', '2026-08-21T16:53:59+08:00')

  assert.equal(stale.stale, true)
  assert.equal(stale.event_value.metadata.outputRejectionReason, 'stale_event')
  assert.equal(await outputCount(db), 1)
})

test('rejected S-05 pulse is absent from the live latest-event view', async (t) => {
  const db = await database(t)

  await ingest(db, 'S-03', 'idle', '2026-08-21T16:53:00+08:00')
  await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')
  const snapshot = (await db.query("select get_machine_live_snapshot('M-01') as snapshot")).rows[0].snapshot
  const outputSensor = snapshot.sensors.find((sensor) => sensor.sensor_code === 'S-05')

  assert.equal(outputSensor.latest_event, null)
})

test('S-05 output validation cannot be bypassed by watchdog state', async (t) => {
  const db = await database(t)

  await db.query(`update sensor_watchdog_state
    set detection_state='downtime'
    where sensor_id=(select id from sensors where sensor_code='S-05')`)
  await ingest(db, 'S-03', 'idle', '2026-08-21T16:53:00+08:00')
  const outputPulse = await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')

  assert.equal(outputPulse.event_value.metadata.outputAccepted, false)
  assert.equal(outputPulse.event_value.metadata.outputRejectionReason, 'machine_stationary')
  assert.equal(await outputCount(db), 0)
})

test('S-05 output validation cannot be bypassed by watchdog fault ownership', async (t) => {
  const db = await database(t)

  await db.query(`update sensors
    set fault_source='absence_watchdog'
    where sensor_code='S-05'`)
  await ingest(db, 'S-03', 'idle', '2026-08-21T16:53:00+08:00')
  const outputPulse = await ingest(db, 'S-05', 'pulse', '2026-08-21T16:54:00+08:00')

  assert.equal(outputPulse.event_value.metadata.outputAccepted, false)
  assert.equal(outputPulse.event_value.metadata.outputRejectionReason, 'machine_stationary')
  assert.equal(await outputCount(db), 0)
})
