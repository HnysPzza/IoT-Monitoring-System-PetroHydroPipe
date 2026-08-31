const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '018_add_manual_sensor_recovery_override.sql'),
  'utf8',
)

const ROLE_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const MACHINE_ID = '30000000-0000-4000-8000-000000000003'
const SENSOR_ID = '40000000-0000-4000-8000-000000000004'
const DOWNTIME_ID = '50000000-0000-4000-8000-000000000005'
const ALERT_ID = '60000000-0000-4000-8000-000000000006'

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

async function seedIncident(db) {
  await db.query("insert into public.roles (id, name) values ($1, 'Admin')", [ROLE_ID])
  await db.query(`
    insert into public.users (id, role_id, name, username, password_hash, status)
    values ($1, $2, 'Admin User', 'admin', 'hash', 'Active')
  `, [USER_ID, ROLE_ID])
  await db.query(`
    insert into public.machines (id, machine_code, name, status)
    values ($1, 'M-01', 'Spiral Mill 01', 'Downtime')
  `, [MACHINE_ID])
  await db.query(`
    insert into public.sensors (id, machine_id, sensor_code, esp32_device_id, label, status, last_applied_recorded_at)
    values ($1, $2, 'S-02', 'esp32-m01-s02', 'Inside Filler Wire', 'Fault', now() - interval '10 minutes')
  `, [SENSOR_ID, MACHINE_ID])
  await db.query(`
    insert into public.downtime_events (id, machine_id, sensor_id, started_at, cause, status)
    values ($1, $2, $3, now() - interval '5 minutes', 'Consumable Shortage', 'Open')
  `, [DOWNTIME_ID, MACHINE_ID, SENSOR_ID])
  await db.query(`
    insert into public.alerts (id, source_type, source_id, machine_id, sensor_id, severity, status, title, message, metadata)
    values ($1, 'sensor', $2, $3, $2, 'Critical', 'Active', 'S-02 downtime', 'No pulse', '{}'::jsonb)
  `, [ALERT_ID, SENSOR_ID, MACHINE_ID])
}

test('migration 018 applies an atomic manual recovery while preserving later physical events', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedIncident(db)
  await db.exec(migrationSql)

  await db.exec('set role service_role;')
  const override = await db.query(
    'select * from public.override_sensor_recovery($1, $2, $3)',
    [SENSOR_ID, USER_ID, 'Verified by maintenance supervisor'],
  )
  assert.equal(override.rows[0].downtime_action, 'resolved')
  assert.equal(override.rows[0].alert_action, 'updated')
  assert.equal(override.rows[0].alert_record.status, 'Active')
  assert.equal(override.rows[0].alert_record.metadata.recoveryPending, true)
  assert.equal(override.rows[0].alert_record.metadata.recoverySource, 'manual_override')
  await db.exec('reset role;')

  const state = await db.query(`
    select
      (select status from public.sensors where id = $1) as sensor_status,
      (select status from public.machines where id = $2) as machine_status,
      (select status from public.downtime_events where id = $3) as downtime_status,
      (select status from public.alerts where id = $4) as alert_status
  `, [SENSOR_ID, MACHINE_ID, DOWNTIME_ID, ALERT_ID])
  assert.deepEqual(state.rows[0], {
    sensor_status: 'Active',
    machine_status: 'Running',
    downtime_status: 'Resolved',
    alert_status: 'Active',
  })

  const audit = await db.query(`
    select metadata->>'reason' as reason
    from public.audit_logs
    where action = 'SENSOR_MANUAL_RECOVERY_OVERRIDE' and entity_id = $1
  `, [SENSOR_ID])
  assert.deepEqual(audit.rows, [{ reason: 'Verified by maintenance supervisor' }])

  await db.exec('set role service_role;')
  const acknowledged = await db.query('select * from public.acknowledge_alert($1, $2)', [ALERT_ID, USER_ID])
  assert.equal(acknowledged.rows[0].outcome, 'resolved_after_recovery')

  const physicalEvent = await db.query(`
    select * from public.ingest_iot_sensor_event(
      $1, $2, $3, 'pulse', '{"signal":"active"}'::jsonb, now()
    )
  `, ['70000000-0000-4000-8000-000000000007', SENSOR_ID, MACHINE_ID])
  assert.equal(physicalEvent.rows[0].state_applied, true)
  assert.equal(physicalEvent.rows[0].downtime_action, null)
  await db.exec('reset role;')

  const eventCount = await db.query(
    'select count(*)::integer as count from public.sensor_events where sensor_id = $1',
    [SENSOR_ID],
  )
  assert.equal(eventCount.rows[0].count, 1)
})

test('manual recovery override is unavailable to authenticated browser roles', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedIncident(db)

  await db.exec('set role authenticated;')
  await assert.rejects(
    db.query('select * from public.override_sensor_recovery($1, $2, $3)', [SENSOR_ID, USER_ID, 'Not allowed']),
    /permission denied/i,
  )
})

test('fresh schema includes the secured manual recovery and acknowledgement RPCs', async (t) => {
  const db = await createDatabase({ applyMigration: false })
  t.after(() => db.close())

  const functions = await db.query(`
    select proname, prosecdef
    from pg_proc
    where oid in (
      'public.override_sensor_recovery(uuid, uuid, text)'::regprocedure,
      'public.acknowledge_alert(uuid, uuid)'::regprocedure
    )
    order by proname
  `)

  assert.deepEqual(functions.rows, [
    { proname: 'acknowledge_alert', prosecdef: true },
    { proname: 'override_sensor_recovery', prosecdef: true },
  ])
})
