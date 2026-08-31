const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const currentSchemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const seedSql = fs.readFileSync(path.join(backendRoot, 'database', 'seed.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '009_align_sensor_downtime_causes.sql'),
  'utf8',
)

const prePhaseThreeSchemaSql = currentSchemaSql.split('-- Phase 3 operational-time and atomic watchdog functions.')[0]
const preMigrationSchemaSql = prePhaseThreeSchemaSql
  .replace("when 'S-02' then 'Consumable Shortage'", "when 'S-02' then 'Weld Wire Refill'")
  .replace("when 'S-04' then 'Consumable Shortage'", "when 'S-04' then 'Flux Refill'")

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role;')
  return db
}

test('migration 009 aligns filler-wire causes and is safe to reapply', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  await db.exec(preMigrationSchemaSql)
  await db.exec(seedSql)
  await db.exec(migrationSql)
  await db.exec(migrationSql)

  const { rows: sensors } = await db.query(`
    select sensor.id, sensor.sensor_code, sensor.machine_id
    from public.sensors sensor
    where sensor.sensor_code in ('S-02', 'S-03', 'S-04')
    order by sensor.sensor_code
  `)

  for (const sensor of sensors) {
    await db.query(
      `select * from public.ingest_iot_sensor_event(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        'fault',
        '{"signal":"fault"}'::jsonb,
        now()
      )`,
      [randomUUID(), sensor.id, sensor.machine_id],
    )
  }

  const { rows: causes } = await db.query(`
    select sensor.sensor_code, downtime.cause
    from public.downtime_events downtime
    join public.sensors sensor on sensor.id = downtime.sensor_id
    order by sensor.sensor_code
  `)

  assert.deepEqual(causes, [
    { sensor_code: 'S-02', cause: 'Consumable Shortage' },
    { sensor_code: 'S-03', cause: 'Pending Cause Review' },
    { sensor_code: 'S-04', cause: 'Consumable Shortage' },
  ])
})

test('Phase 3 ingestion wrapper preserves the aligned legacy cause mapping', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  await db.exec(currentSchemaSql)
  await db.exec(seedSql)

  const { rows: sensors } = await db.query(`
    select sensor.id, sensor.sensor_code, sensor.machine_id
    from public.sensors sensor
    where sensor.sensor_code in ('S-02', 'S-04')
    order by sensor.sensor_code
  `)
  for (const sensor of sensors) {
    await db.query(`select * from public.ingest_iot_sensor_event(
      $1, $2, $3, 'fault', '{"signal":"fault"}', now()
    )`, [randomUUID(), sensor.id, sensor.machine_id])
  }

  const { rows } = await db.query(`
    select sensor.sensor_code, downtime.cause
    from public.downtime_events downtime
    join public.sensors sensor on sensor.id = downtime.sensor_id
    order by sensor.sensor_code
  `)
  assert.deepEqual(rows, [
    { sensor_code: 'S-02', cause: 'Consumable Shortage' },
    { sensor_code: 'S-04', cause: 'Consumable Shortage' },
  ])
})
