const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const snapshotMarker = '-- Phase 4 consistent live monitoring snapshot.'
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const preSnapshotSchemaSql = schemaSql.split(snapshotMarker)[0]
const seedSql = fs.readFileSync(path.join(backendRoot, 'database', 'seed.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '015_add_live_monitoring_snapshot.sql'),
  'utf8',
)

async function createDatabase({ freshSchema = false } = {}) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(freshSchema ? schemaSql : preSnapshotSchemaSql)
  await db.exec(seedSql)
  return db
}

async function getSnapshot(db, machineCode = 'M-01') {
  const { rows } = await db.query(
    'select public.get_machine_live_snapshot($1) as snapshot',
    [machineCode],
  )
  return rows[0].snapshot
}

function comparable(snapshot) {
  return {
    machine: {
      machine_code: snapshot.machine.machine_code,
      name: snapshot.machine.name,
      status: snapshot.machine.status,
      location: snapshot.machine.location,
    },
    sensors: snapshot.sensors.map((sensor) => ({
      sensor_code: sensor.sensor_code,
      esp32_device_id: sensor.esp32_device_id,
      label: sensor.label,
      status: sensor.status,
      latest_event: sensor.latest_event,
      watchdog: sensor.watchdog,
    })),
  }
}

test('migration 015 applies after Phase 3, is safe to reapply, and matches fresh schema', async (t) => {
  const migrated = await createDatabase()
  const fresh = await createDatabase({ freshSchema: true })
  t.after(() => Promise.all([migrated.close(), fresh.close()]))

  await migrated.exec(migrationSql)
  await migrated.exec(migrationSql)

  const migratedSnapshot = await getSnapshot(migrated)
  const freshSnapshot = await getSnapshot(fresh)
  assert.deepEqual(comparable(migratedSnapshot), comparable(freshSnapshot))
  assert.equal(migratedSnapshot.machine.machine_code, 'M-01')
  assert.deepEqual(migratedSnapshot.sensors.map((sensor) => sensor.sensor_code), [
    'S-01', 'S-02', 'S-03', 'S-04', 'S-05',
  ])
})

test('snapshot returns the latest event independently for each sensor', async (t) => {
  const db = await createDatabase({ freshSchema: true })
  t.after(() => db.close())
  await db.exec(`
    insert into public.sensor_events (sensor_id, machine_id, event_type, event_value, recorded_at)
    select sensor.id, sensor.machine_id, 'pulse', jsonb_build_object('signal', 's01-' || series),
      '2026-08-22T00:00:00Z'::timestamptz + make_interval(secs => series)
    from public.sensors sensor cross join generate_series(1, 101) series
    where sensor.sensor_code = 'S-01';

    insert into public.sensor_events (sensor_id, machine_id, event_type, event_value, recorded_at)
    select sensor.id, sensor.machine_id, 'idle', '{"signal":"s02-latest"}'::jsonb,
      '2026-08-22T00:00:30Z'::timestamptz
    from public.sensors sensor where sensor.sensor_code = 'S-02';
  `)

  const snapshot = await getSnapshot(db)
  assert.equal(snapshot.sensors.find((sensor) => sensor.sensor_code === 'S-01').latest_event.signal, 's01-101')
  assert.equal(snapshot.sensors.find((sensor) => sensor.sensor_code === 'S-02').latest_event.signal, 's02-latest')
  assert.equal(snapshot.sensors.find((sensor) => sensor.sensor_code === 'S-03').latest_event, null)
})

test('snapshot is read-only and tolerates a missing watchdog row', async (t) => {
  const db = await createDatabase({ freshSchema: true })
  t.after(() => db.close())
  await db.exec(`
    delete from public.sensor_watchdog_state where sensor_id = (
      select id from public.sensors where sensor_code = 'S-04'
    );
  `)
  const before = await db.query(`
    select
      (select count(*) from public.sensor_events)::integer as events,
      (select count(*) from public.sensor_watchdog_transitions)::integer as transitions,
      (select count(*) from public.downtime_events)::integer as downtime,
      (select count(*) from public.alerts)::integer as alerts
  `)
  const snapshot = await getSnapshot(db)
  const after = await db.query(`
    select
      (select count(*) from public.sensor_events)::integer as events,
      (select count(*) from public.sensor_watchdog_transitions)::integer as transitions,
      (select count(*) from public.downtime_events)::integer as downtime,
      (select count(*) from public.alerts)::integer as alerts
  `)

  assert.equal(snapshot.sensors.find((sensor) => sensor.sensor_code === 'S-04').watchdog, null)
  assert.deepEqual(after.rows[0], before.rows[0])
})

test('snapshot validates machine codes and is callable only by service role', async (t) => {
  const db = await createDatabase({ freshSchema: true })
  t.after(() => db.close())

  await assert.rejects(getSnapshot(db, "M-01' or '1'='1"), /Machine code is invalid/)
  await assert.rejects(getSnapshot(db, 'M-99'), /Machine was not found/)
  await db.exec('set role authenticated;')
  await assert.rejects(getSnapshot(db), /permission denied/)
  await db.exec('reset role; set role service_role;')
  const snapshot = await getSnapshot(db)
  await db.exec('reset role;')
  assert.equal(snapshot.sensors.find((sensor) => sensor.sensor_code === 'S-05').watchdog.detection_state, 'disabled')
})
