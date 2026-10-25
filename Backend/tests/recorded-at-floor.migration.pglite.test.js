const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../database')
const migrationName = '048_enforce_recorded_at_floor.sql'

async function database(t) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= 48
    })
    .sort()
    .map((name) => fs.readFileSync(path.join(databaseRoot, 'migrations', name), 'utf8'))
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, must_change_password, role_id)
    select 'RecordedAt Floor Admin', 'recorded-at-floor-admin', 'hash', false, id from roles where name = 'Admin'`)
  for (const migration of migrations) await db.exec(migration)
  return db
}

function ingestEvent(db, sensorCode, eventType, signal, recordedAt, rpc = 'ingest_iot_sensor_event') {
  return db.query(`
    select result.*
    from sensors sensor
    cross join lateral ${rpc}(
      $1, sensor.id, sensor.machine_id, $2, $3::jsonb, $4
    ) result
    where sensor.sensor_code = $5
  `, [randomUUID(), eventType, JSON.stringify({ signal, metadata: {} }), recordedAt, sensorCode])
}

function ingestHeartbeat(db, sensorCode, recordedAt) {
  return db.query(`
    select result.*
    from sensors sensor
    cross join lateral public.ingest_iot_heartbeat(
      $1, sensor.id, sensor.machine_id, 1::bigint, $2, 1::bigint, $3, true
    ) result
    where sensor.sensor_code = $4
  `, [randomUUID(), randomUUID(), recordedAt, sensorCode])
}

async function snapshot(db) {
  return (await db.query(`select
    (select count(*)::int from sensor_events) as events,
    (select count(*)::int from alerts) as alerts,
    (select count(*)::int from downtime_events) as downtime,
    (select json_agg(last_applied_recorded_at order by sensor_code) from sensors) as watermarks,
    (select status from machines where machine_code = 'M-01') as machine_status`)).rows[0]
}

function isPastTimestampError(error) {
  return error.code === '22023' && /too far in the past/i.test(error.message)
}

test('sensor events and heartbeats before 2026-05-01T00:00:00+08:00 are rejected without poisoning watermarks', async (t) => {
  const db = await database(t)
  const before = await snapshot(db)

  for (const invalidAt of ['1970-01-01T00:00:00Z', '2026-04-30T23:59:59+08:00']) {
    await assert.rejects(
      ingestEvent(db, 'S-01', 'pulse', 'active', invalidAt, 'ingest_iot_sensor_event'),
      isPastTimestampError,
    )
    await assert.rejects(
      ingestEvent(db, 'S-03', 'downtime', 'no_pulse', invalidAt, 'ingest_iot_sensor_event'),
      isPastTimestampError,
    )
    await assert.rejects(
      ingestEvent(db, 'S-05', 'fault', 'fault', invalidAt, 'ingest_iot_sensor_event'),
      isPastTimestampError,
    )
    await assert.rejects(
      ingestEvent(db, 'S-02', 'pulse', 'active', invalidAt, 'ingest_iot_grouped_sensor_event'),
      isPastTimestampError,
    )
    await assert.rejects(
      ingestHeartbeat(db, 'S-01', invalidAt),
      isPastTimestampError,
    )
  }

  assert.deepEqual(await snapshot(db), before)
})

test('exact 2026-05-01T00:00:00+08:00 boundary is accepted and get_analytics_first_recorded_at ignores pre-May rows', async (t) => {
  const db = await database(t)
  const machineId = (await db.query("select id from machines where machine_code = 'M-01'")).rows[0].id
  const s01Id = (await db.query("select id from sensors where sensor_code = 'S-01'")).rows[0].id

  await db.query(`
    insert into public.sensor_events (sensor_id, machine_id, event_type, recorded_at)
    values ($1, $2, 'pulse', '1970-01-01T00:00:00Z')
  `, [s01Id, machineId])
  await db.query('update public.sensors set last_applied_recorded_at = null where id = $1', [s01Id])

  const beforeValid = await db.query('select public.get_analytics_first_recorded_at($1) as first_at', [machineId])
  assert.equal(beforeValid.rows[0].first_at, null)

  const boundaryAt = '2026-05-01T00:00:00+08:00'
  const { rows } = await ingestEvent(db, 'S-01', 'pulse', 'active', boundaryAt)
  assert.equal(rows[0].state_applied, true)

  const afterValid = await db.query('select public.get_analytics_first_recorded_at($1) as first_at', [machineId])
  assert.equal(afterValid.rows[0].first_at.toISOString(), '2026-04-30T16:00:00.000Z')
})

test('migration 048 reports readiness 48 and is safe to reapply', async (t) => {
  const db = await database(t)

  await db.exec(fs.readFileSync(path.join(databaseRoot, 'migrations', migrationName), 'utf8'))

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 48)
})
