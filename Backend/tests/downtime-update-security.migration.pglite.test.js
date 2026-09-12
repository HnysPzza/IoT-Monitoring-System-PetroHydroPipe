const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '017_secure_downtime_update_rpc.sql'),
  'utf8',
)

const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const SENSOR_ID = '22222222-2222-4222-8222-222222222222'
const DOWNTIME_ID = '33333333-3333-4333-8333-333333333333'

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(schemaSql)
  return db
}

async function seedOpenDowntime(db) {
  await db.query(
    `
    insert into public.machines (id, machine_code, name, status)
    values ($1, 'M-01', 'Spiral Mill 01', 'Running')
    `,
    [MACHINE_ID],
  )
  await db.query(
    `
    insert into public.sensors (id, machine_id, sensor_code, esp32_device_id, label, status)
    values ($2, $1, 'S-02', 'ESP32-S02', 'Inside Filler', 'Active')
    `,
    [MACHINE_ID, SENSOR_ID],
  )
  await db.query(
    `
    insert into public.downtime_events (id, machine_id, sensor_id, started_at, status)
    values ($3, $1, $2, now() - interval '5 minutes', 'Open')
    `,
    [MACHINE_ID, SENSOR_ID, DOWNTIME_ID],
  )
}

test('migration 017 preserves RPC metadata updates without restoring direct table writes', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedOpenDowntime(db)

  // Recreate the deployed pre-017 state, then prove the migration repairs it.
  await db.exec(`
    alter function public.update_downtime_record(uuid, text, text, boolean, boolean)
      security invoker;
  `)
  await db.exec(migrationSql)
  await db.exec(migrationSql)

  const functionState = await db.query(`
    select prosecdef
    from pg_proc
    where oid = 'public.update_downtime_record(uuid, text, text, boolean, boolean)'::regprocedure
  `)
  assert.equal(functionState.rows[0].prosecdef, true)

  await db.exec('set role service_role;')
  await assert.rejects(
    db.query('update public.downtime_events set notes = $1 where id = $2', ['forbidden', DOWNTIME_ID]),
    /permission denied/i,
  )
  const rpcResult = await db.query(
    'select * from public.update_downtime_record($1, null, $2, true, false)',
    [DOWNTIME_ID, 'reviewed'],
  )
  assert.deepEqual(rpcResult.rows, [{ downtime_id: DOWNTIME_ID }])
  await db.exec('reset role;')

  await db.exec('set role authenticated;')
  await assert.rejects(
    db.query(
      'select * from public.update_downtime_record($1, null, null, false, true)',
      [DOWNTIME_ID],
    ),
    /permission denied/i,
  )
  await db.exec('reset role;')

  const resolved = await db.query(`
    select status, notes, ended_at is not null as has_ended_at, duration_seconds is not null as has_duration
    from public.downtime_events
    where id = $1
  `, [DOWNTIME_ID])
  assert.deepEqual(resolved.rows, [{
    status: 'Open', notes: 'reviewed', has_ended_at: false, has_duration: false,
  }])
})

test('fresh schema keeps the downtime update RPC security-definer', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  const functionState = await db.query(`
    select prosecdef
    from pg_proc
    where oid = 'public.update_downtime_record(uuid, text, text, boolean, boolean)'::regprocedure
  `)

  assert.equal(functionState.rows[0].prosecdef, true)
})

test('fresh schema preserves the migration-028 manual resolution contract', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await seedOpenDowntime(db)

  await db.exec('set role service_role;')
  await db.query('select * from public.update_downtime_record($1, null, null, false, true)', [DOWNTIME_ID])
  await db.exec('reset role;')

  const state = await db.query('select status from public.downtime_events where id = $1', [DOWNTIME_ID])
  assert.deepEqual(state.rows, [{ status: 'Resolved' }])
})
