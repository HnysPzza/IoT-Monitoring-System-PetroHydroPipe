const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '019_add_analytics_event_aggregation.sql'),
  'utf8',
)

const MACHINE_ID = '30000000-0000-4000-8000-000000000003'
const SENSOR_ID = '40000000-0000-4000-8000-000000000004'

async function createDatabase({ applyMigration = true } = {}) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(schemaSql)
  if (applyMigration) await db.exec(migrationSql)
  return db
}

async function seedEvents(db) {
  await db.query(`
    insert into public.machines (id, machine_code, name, status)
    values ($1, 'M-01', 'Spiral Mill 01', 'Running')
  `, [MACHINE_ID])
  await db.query(`
    insert into public.sensors (id, machine_id, sensor_code, esp32_device_id, label)
    values ($1, $2, 'S-05', 'esp32-m01-s05', 'Production Output Cutting')
  `, [SENSOR_ID, MACHINE_ID])
  await db.query(`
    insert into public.sensor_events (sensor_id, machine_id, event_type, recorded_at)
    select $1, $2, 'pulse', '2026-08-01T00:00:00Z'::timestamptz + (n * interval '1 second')
    from generate_series(0, 1004) as n
  `, [SENSOR_ID, MACHINE_ID])
}

test('migration 019 aggregates more than 1000 pulse events and is safe to reapply', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedEvents(db)
  await db.exec(migrationSql)

  await db.exec('set role service_role;')
  const result = await db.query(`
    select bucket_start, sensor_code, sensor_label, event_count
    from public.aggregate_analytics_sensor_events(
      $1, '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z', 14400
    )
  `, [MACHINE_ID])
  await db.exec('reset role;')

  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].sensor_code, 'S-05')
  assert.equal(result.rows[0].sensor_label, 'Production Output Cutting')
  assert.equal(Number(result.rows[0].event_count), 1005)
})

test('analytics aggregation RPC rejects invalid windows and browser roles', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedEvents(db)

  await db.exec('set role authenticated;')
  await assert.rejects(
    db.query(`select * from public.aggregate_analytics_sensor_events($1, now(), now(), 3600)`, [MACHINE_ID]),
    /permission denied/i,
  )
  await db.exec('reset role; set role service_role;')
  await assert.rejects(
    db.query(`select * from public.aggregate_analytics_sensor_events($1, now(), now(), 3600)`, [MACHINE_ID]),
    /invalid/i,
  )
})

test('analytics aggregation RPC groups calendar months in Manila time', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedEvents(db)

  await db.exec('set role service_role;')
  const result = await db.query(`
    select bucket_start, event_count
    from public.aggregate_analytics_sensor_events(
      $1, '2026-07-15T16:00:00Z', '2026-09-01T16:00:00Z', 0
    )
  `, [MACHINE_ID])
  await db.exec('reset role;')

  assert.equal(result.rows[0].bucket_start.toISOString(), '2026-07-31T16:00:00.000Z')
  assert.equal(Number(result.rows[0].event_count), 1005)
})

test('fresh schema mirrors the secured analytics aggregation RPC', async (t) => {
  const db = await createDatabase({ applyMigration: false })
  t.after(() => db.close())

  const result = await db.query(`
    select prosecdef,
      has_function_privilege('service_role', oid, 'EXECUTE') as service_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_execute
    from pg_proc
    where oid = 'public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)'::regprocedure
  `)

  assert.deepEqual(result.rows, [{
    prosecdef: false,
    service_execute: true,
    authenticated_execute: false,
  }])
})
