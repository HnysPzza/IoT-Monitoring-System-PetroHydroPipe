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
const currentMigrationSql = [
  '029_account_onboarding.sql',
  '030_verify_login_credentials.sql',
  '031_atomic_login_audit.sql',
  '032_grouped_downtime_rule.sql',
  '033_repair_grouped_downtime_dispatch.sql',
  '034_route_output_telemetry_through_grouped_reconciliation.sql',
  '035_fix_sensor_audit.sql',
].map((name) => fs.readFileSync(path.join(backendRoot, 'database', 'migrations', name), 'utf8'))

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

test('current grouped ingestion keeps two filler faults out of S-03 downtime records', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  await db.exec(currentSchemaSql)
  await db.exec(seedSql)
  await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Migration Admin', 'migration-admin', 'hash', id from roles where name = 'Admin'`)
  for (const migration of currentMigrationSql) await db.exec(migration)

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
  assert.deepEqual(rows, [])
  assert.deepEqual((await db.query(`select sensor_code, status from sensors
    where sensor_code in ('S-02', 'S-03', 'S-04') order by sensor_code`)).rows, [
    { sensor_code: 'S-02', status: 'Fault' },
    { sensor_code: 'S-03', status: 'Active' },
    { sensor_code: 'S-04', status: 'Fault' },
  ])
  assert.equal((await db.query('select status from machines where machine_code = $1', ['M-01'])).rows[0].status, 'Running')
})
