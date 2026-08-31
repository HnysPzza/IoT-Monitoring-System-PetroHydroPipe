const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '020_add_analytics_all_time_range.sql'),
  'utf8',
)

const MACHINE_ID = '30000000-0000-4000-8000-000000000003'
const SENSOR_ID = '40000000-0000-4000-8000-000000000004'

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(schemaSql)
  await db.exec(migrationSql)
  return db
}

async function seedRecords(db) {
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
    values ($1, $2, 'pulse', '2024-01-15T03:00:00Z')
  `, [SENSOR_ID, MACHINE_ID])
}

test('migration 020 finds the first contributing record and supports secured long-range aggregation', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedRecords(db)
  await db.exec(migrationSql)

  await db.exec('set role service_role;')
  const first = await db.query(
    'select public.get_analytics_first_recorded_at($1) as recorded_at',
    [MACHINE_ID],
  )
  const aggregate = await db.query(`
    select sensor_code, event_count
    from public.aggregate_analytics_sensor_events(
      $1, '2024-01-01T00:00:00Z', '2026-08-04T00:00:00Z', 0
    )
  `, [MACHINE_ID])
  await db.exec('reset role;')

  assert.equal(first.rows[0].recorded_at.toISOString(), '2024-01-15T03:00:00.000Z')
  assert.equal(aggregate.rows[0].sensor_code, 'S-05')
  assert.equal(Number(aggregate.rows[0].event_count), 1)
})

test('all-time Analytics functions remain backend-only in the fresh schema', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  const result = await db.query(`
    select
      has_function_privilege('service_role', 'public.get_analytics_first_recorded_at(uuid)', 'EXECUTE') as service_first,
      has_function_privilege('authenticated', 'public.get_analytics_first_recorded_at(uuid)', 'EXECUTE') as client_first,
      has_function_privilege('service_role', 'public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)', 'EXECUTE') as service_aggregate,
      has_function_privilege('authenticated', 'public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)', 'EXECUTE') as client_aggregate
  `)

  assert.deepEqual(result.rows, [{
    service_first: true,
    client_first: false,
    service_aggregate: true,
    client_aggregate: false,
  }])
})
