const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../database')
const migrationPath = path.join(databaseRoot, 'migrations/028_persist_telemetry_staleness.sql')

async function createDatabase(t, applyMigration = true) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'seed.sql'), 'utf8'))
  if (applyMigration) await db.exec(fs.readFileSync(migrationPath, 'utf8'))
  return db
}

async function sensorIds(db, code) {
  return (await db.query('select id, machine_id from sensors where sensor_code = $1', [code])).rows[0]
}

async function ingest(db, sensor, recordedAt, eventId = randomUUID(), functionName = 'ingest_iot_sensor_event') {
  return (await db.query(`select * from public.${functionName}($1,$2,$3,'pulse','{"signal":"active"}'::jsonb,$4)`,
    [eventId, sensor.id, sensor.machine_id, recordedAt])).rows[0]
}

async function countPulses(db, machineId) {
  return Number((await db.query(`select coalesce(sum(event_count),0) as count
    from aggregate_analytics_sensor_events($1,'2026-08-01','2026-09-01',3600)`, [machineId])).rows[0].count)
}

test('stale and equal-time pulses remain raw evidence without inflating totals or moving the all-time start', async (t) => {
  const db = await createDatabase(t)
  const sensor = await sensorIds(db, 'S-05')
  const eventId = randomUUID()
  await ingest(db, sensor, '2026-08-20T10:05:00Z', eventId)
  assert.equal((await ingest(db, sensor, '2026-08-20T10:05:00Z', eventId)).duplicate, true)
  assert.equal((await ingest(db, sensor, '2026-08-20T10:03:00Z')).stale, true)
  assert.equal((await ingest(db, sensor, '2026-08-20T10:05:00Z')).stale, true)
  assert.equal(await countPulses(db, sensor.machine_id), 1)
  const rows = await db.query('select stale from sensor_events where sensor_id=$1 order by recorded_at, stale', [sensor.id])
  assert.deepEqual(rows.rows, [{ stale: true }, { stale: false }, { stale: true }])
  const first = await db.query('select get_analytics_first_recorded_at($1) as first', [sensor.machine_id])
  assert.equal(first.rows[0].first.toISOString(), '2026-08-20T10:05:00.000Z')
  await assert.rejects(ingest(db, sensor, '2026-08-20T10:06:00Z', eventId), /reused/)
  assert.equal(await countPulses(db, sensor.machine_id), 1)
})

test('watchdog observation persists staleness without advancing recovery or activity', async (t) => {
  const db = await createDatabase(t)
  const sensor = await sensorIds(db, 'S-01')
  await ingest(db, sensor, '2026-08-20T10:05:00Z', randomUUID(), 'ingest_iot_watchdog_observation')
  const before = await db.query('select * from sensor_watchdog_state where sensor_id=$1', [sensor.id])
  const stale = await ingest(db, sensor, '2026-08-20T10:03:00Z', randomUUID(), 'ingest_iot_watchdog_observation')
  assert.equal(stale.state_applied, false)
  assert.equal(await countPulses(db, sensor.machine_id), 1)
  assert.deepEqual((await db.query('select * from sensor_watchdog_state where sensor_id=$1', [sensor.id])).rows, before.rows)
  assert.equal((await db.query('select stale from sensor_events where id=$1', [stale.sensor_event_id])).rows[0].stale, true)
})

test('migration preserves unknown history, is repeatable, and protects classification from caller input', async (t) => {
  const db = await createDatabase(t)
  const sensor = await sensorIds(db, 'S-05')
  await db.exec('drop trigger classify_sensor_event_staleness on sensor_events; alter table sensor_events drop column stale;')
  await ingest(db, sensor, '2026-08-20T09:00:00Z')
  await db.exec(fs.readFileSync(migrationPath, 'utf8'))
  assert.deepEqual((await db.query('select stale from sensor_events')).rows, [{ stale: null }])
  assert.equal(await countPulses(db, sensor.machine_id), 1)
  await db.query(`insert into sensor_events(sensor_id,machine_id,event_type,recorded_at,stale)
    values ($1,$2,'pulse','2026-08-20T08:00:00Z',false)`, [sensor.id, sensor.machine_id])
  await db.exec(fs.readFileSync(migrationPath, 'utf8'))
  assert.equal(await countPulses(db, sensor.machine_id), 1)
  assert.equal((await db.query('select count(*)::integer as count from sensor_events where stale is true')).rows[0].count, 1)
  await db.exec('set role service_role;')
  assert.equal(await countPulses(db, sensor.machine_id), 1)
  await assert.rejects(db.query(`insert into sensor_events(sensor_id,machine_id,event_type,recorded_at,stale)
    values ($1,$2,'pulse',now(),false)`, [sensor.id, sensor.machine_id]), /permission denied/)
  await db.exec('reset role; set role anon;')
  await assert.rejects(countPulses(db, sensor.machine_id), /permission denied/)
  await db.exec('reset role;')
})

test('readiness requires telemetry classification and rejects a disabled guard', async (t) => {
  const db = await createDatabase(t)
  assert.equal((await db.query('select get_backend_readiness() as version')).rows[0].version, 28)
  await db.exec('alter table sensor_events disable trigger classify_sensor_event_staleness;')
  await assert.rejects(db.query('select get_backend_readiness()'), /dependencies are missing/)
})

test('equal-time stale events cannot replace the live snapshot event through UUID tie ordering', async (t) => {
  const db = await createDatabase(t)
  const sensor = await sensorIds(db, 'S-05')
  const fresh = await ingest(db, sensor, '2026-08-20T10:05:00Z')
  await db.query("update sensor_events set id='00000000-0000-4000-8000-000000000001' where id=$1", [fresh.sensor_event_id])
  const stale = (await db.query(`select * from ingest_iot_sensor_event($1,$2,$3,'idle','{"signal":"idle"}'::jsonb,'2026-08-20T10:05:00Z')`,
    [randomUUID(), sensor.id, sensor.machine_id])).rows[0]
  await db.query("update sensor_events set id='ffffffff-ffff-4fff-bfff-ffffffffffff' where id=$1", [stale.sensor_event_id])
  const snapshot = (await db.query("select get_machine_live_snapshot('M-01') as snapshot")).rows[0].snapshot
  assert.equal(snapshot.sensors.find((entry) => entry.sensor_code === 'S-05').latest_event.event_type, 'pulse')
})

test('rolled-back ingestion leaves no classified event or sensor watermark behind', async (t) => {
  const db = await createDatabase(t)
  const sensor = await sensorIds(db, 'S-05')
  const before = (await db.query('select * from sensors where id=$1', [sensor.id])).rows
  await db.exec('begin;')
  await ingest(db, sensor, '2026-08-20T10:05:00Z')
  await ingest(db, sensor, '2026-08-20T10:03:00Z')
  await db.exec('rollback;')
  assert.equal((await db.query('select count(*)::integer as count from sensor_events')).rows[0].count, 0)
  assert.deepEqual((await db.query('select * from sensors where id=$1', [sensor.id])).rows, before)
})

test('fresh schema classifies stale history without applying the upgrade migration', async (t) => {
  const db = await createDatabase(t, false)
  const sensor = await sensorIds(db, 'S-05')
  await ingest(db, sensor, '2026-08-20T10:05:00Z')
  await ingest(db, sensor, '2026-08-20T10:03:00Z')
  assert.equal(await countPulses(db, sensor.machine_id), 1)
  assert.deepEqual((await db.query('select stale from sensor_events order by recorded_at')).rows, [{ stale: true }, { stale: false }])
})
