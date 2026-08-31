const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '022_require_reviewed_cause_before_resolve.sql'),
  'utf8',
)

const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const SENSOR_ID = '33333333-3333-4333-8333-333333333333'
const DOWNTIME_ID = '55555555-5555-4555-8555-555555555555'

test('migration 022 requires an S-03 cause before resolve and remains backend-only', async (t) => {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(schemaSql)
  await db.exec(migrationSql)
  await db.exec(migrationSql)
  await db.query(
    "insert into public.machines (id, machine_code, name, status) values ($1, 'M-01', 'Spiral Mill 01', 'Running')",
    [MACHINE_ID],
  )
  await db.query(
    "insert into public.sensors (id, machine_id, sensor_code, esp32_device_id, label, status) values ($2, $1, 'S-03', 'ESP32-S03', 'Machine Main Sensor', 'Active')",
    [MACHINE_ID, SENSOR_ID],
  )
  await db.query(
    "insert into public.downtime_events (id, machine_id, sensor_id, started_at, cause, status) values ($3, $1, $2, now() - interval '5 minutes', 'Pending Cause Review', 'Open')",
    [MACHINE_ID, SENSOR_ID, DOWNTIME_ID],
  )

  await db.exec('set role service_role;')
  await assert.rejects(
    db.query('select * from public.update_downtime_record($1, null, null, false, true)', [DOWNTIME_ID]),
    /Choose the downtime cause before resolving this record/,
  )
  const resolved = await db.query(
    "select * from public.update_downtime_record($1, 'Misalignment', null, false, true)",
    [DOWNTIME_ID],
  )
  assert.deepEqual(resolved.rows, [{ downtime_id: DOWNTIME_ID }])
  await db.exec('reset role;')

  await db.exec('set role authenticated;')
  await assert.rejects(
    db.query('select * from public.update_downtime_record($1, null, null, false, true)', [DOWNTIME_ID]),
    /permission denied/i,
  )
  await db.exec('reset role;')
})
