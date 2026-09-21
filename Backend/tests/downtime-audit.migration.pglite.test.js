const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const schemaSql = fs.readFileSync(
  path.resolve(__dirname, '../database/schema.sql'),
  'utf8',
)

const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const SENSOR_ID = '22222222-2222-4222-8222-222222222222'
const DOWNTIME_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const ROLE_ID = '55555555-5555-4555-8555-555555555555'
const INVALID_ACTOR_ID = '66666666-6666-4666-8666-666666666666'

async function createDatabase(t) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(schemaSql)
  await db.query(
    `insert into public.roles (id, name) values ($1, 'Admin')`,
    [ROLE_ID],
  )
  await db.query(
    `insert into public.users (id, role_id, name, username, password_hash)
     values ($1, $2, 'Audit User', 'audit-user', 'test-hash')`,
    [ACTOR_ID, ROLE_ID],
  )
  await db.query(
    `insert into public.machines (id, machine_code, name, status)
     values ($1, 'M-01', 'Spiral Mill 01', 'Downtime')`,
    [MACHINE_ID],
  )
  await db.query(
    `insert into public.sensors (id, machine_id, sensor_code, esp32_device_id, label, status)
     values ($1, $2, 'S-03', 'ESP32-S03', 'Machine Main Sensor', 'Fault')`,
    [SENSOR_ID, MACHINE_ID],
  )
  await db.query(
    `insert into public.downtime_events (id, machine_id, sensor_id, started_at, cause, status)
     values ($1, $2, $3, '2026-09-21T00:00:00Z', 'Pending Cause Review', 'Open')`,
    [DOWNTIME_ID, MACHINE_ID, SENSOR_ID],
  )
  await db.exec('set role service_role;')
  return db
}

test('downtime update records authenticated actor audit in same transaction', async (t) => {
  const db = await createDatabase(t)

  const result = await db.query(
    `select * from public.update_downtime_record($1, $2, $3, $4, $5, $6)`,
    [DOWNTIME_ID, 'Misalignment', 'Reviewed by operator.', true, false, ACTOR_ID],
  )

  assert.deepEqual(result.rows, [{ downtime_id: DOWNTIME_ID }])
  const audit = await db.query(
    `select user_id, action, entity_type, entity_id, metadata
     from public.audit_logs
     where entity_id = $1 and action = 'DOWNTIME_UPDATED'`,
    [DOWNTIME_ID],
  )
  assert.equal(audit.rows.length, 1)
  assert.equal(audit.rows[0].user_id, ACTOR_ID)
  assert.equal(audit.rows[0].entity_type, 'downtime')
  assert.equal(audit.rows[0].metadata.cause, 'Misalignment')
  assert.equal(audit.rows[0].metadata.previousStatus, 'Open')
  assert.equal(audit.rows[0].metadata.sensorCode, 'S-03')
})

test('downtime update rolls back when audit actor cannot satisfy its foreign key', async (t) => {
  const db = await createDatabase(t)

  await assert.rejects(() => db.query(
    `select * from public.update_downtime_record($1, $2, $3, $4, $5, $6)`,
    [DOWNTIME_ID, 'Misalignment', 'This must not persist.', true, false, INVALID_ACTOR_ID],
  ))

  const downtime = await db.query(
    `select cause, notes, status from public.downtime_events where id = $1`,
    [DOWNTIME_ID],
  )
  assert.deepEqual(downtime.rows, [{
    cause: 'Pending Cause Review',
    notes: null,
    status: 'Open',
  }])
  const audits = await db.query(
    `select count(*)::integer as count from public.audit_logs
     where entity_id = $1 and action = 'DOWNTIME_UPDATED'`,
    [DOWNTIME_ID],
  )
  assert.equal(audits.rows[0].count, 0)
})

test('repeating the same downtime update does not duplicate its audit', async (t) => {
  const db = await createDatabase(t)
  const update = `select * from public.update_downtime_record($1, $2, $3, $4, $5, $6)`
  const values = [DOWNTIME_ID, 'Misalignment', 'Reviewed by operator.', true, false, ACTOR_ID]

  await db.query(update, values)
  await db.query(update, values)

  const audits = await db.query(
    `select count(*)::integer as count from public.audit_logs
     where entity_id = $1 and action = 'DOWNTIME_UPDATED'`,
    [DOWNTIME_ID],
  )
  assert.equal(audits.rows[0].count, 1)
})
