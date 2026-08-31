const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const batchMarker = '-- Phase 3 batched watchdog evaluation.'
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const preBatchSchemaSql = schemaSql.split(batchMarker)[0]
const seedSql = fs.readFileSync(path.join(backendRoot, 'database', 'seed.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '014_add_batched_watchdog_evaluation.sql'),
  'utf8',
)

async function createDatabase({ freshSchema = false } = {}) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(freshSchema ? schemaSql : preBatchSchemaSql)
  await db.exec(seedSql)
  return db
}

async function evaluateCycle(db, mode = 'disabled', evaluatedAt = '2026-08-22T04:00:00Z') {
  const { rows } = await db.query(
    'select public.evaluate_watchdog_cycle($1::timestamptz, $2, $3) as result',
    [evaluatedAt, mode, 30],
  )
  return rows[0].result
}

function comparableResult(result) {
  return {
    ...result,
    evaluations: result.evaluations.map(({ evaluated_sensor_id: _sensorId, ...evaluation }) => evaluation),
  }
}

test('migration 014 applies after Phase 3, is safe to reapply, and matches the fresh schema', async (t) => {
  const migrated = await createDatabase()
  const fresh = await createDatabase({ freshSchema: true })
  t.after(() => Promise.all([migrated.close(), fresh.close()]))

  await migrated.exec(migrationSql)
  await migrated.exec(migrationSql)

  const migratedResult = await evaluateCycle(migrated)
  const freshResult = await evaluateCycle(fresh)
  assert.deepEqual(comparableResult(migratedResult), comparableResult(freshResult))
  assert.equal(migratedResult.evaluations.length, 5)
  assert.deepEqual(migratedResult.evaluations.map((item) => item.sensor_code), [
    'S-01', 'S-02', 'S-03', 'S-04', 'S-05',
  ])
  assert.ok(migratedResult.evaluations.every((item) => item.succeeded === true))
})

test('batch evaluation isolates one sensor failure and returns only a controlled error code', async (t) => {
  const db = await createDatabase({ freshSchema: true })
  t.after(() => db.close())
  await db.exec(`
    create function public.reject_s03_watchdog_update() returns trigger language plpgsql as $$
    begin
      if exists (
        select 1 from public.sensors sensor
        where sensor.id = new.sensor_id and sensor.sensor_code = 'S-03'
      ) then
        raise exception 'private sensor failure';
      end if;
      return new;
    end;
    $$;
    create trigger reject_s03_watchdog_update before update on public.sensor_watchdog_state
    for each row execute function public.reject_s03_watchdog_update();
  `)

  const result = await evaluateCycle(db, 'observe')
  const failed = result.evaluations.filter((item) => !item.succeeded)
  assert.equal(result.evaluations.length, 5)
  assert.deepEqual(failed.map((item) => item.sensor_code), ['S-03'])
  assert.equal(failed[0].error_code, 'WATCHDOG_EVALUATION_FAILED')
  assert.doesNotMatch(JSON.stringify(result), /private sensor failure/i)

  const evaluated = await db.query(`
    select sensor.sensor_code, state.last_evaluated_at
    from public.sensor_watchdog_state state
    join public.sensors sensor on sensor.id = state.sensor_id
    order by sensor.sensor_code
  `)
  assert.equal(evaluated.rows.find((row) => row.sensor_code === 'S-03').last_evaluated_at, null)
  assert.ok(evaluated.rows.filter((row) => row.sensor_code !== 'S-03').every((row) => row.last_evaluated_at))
})

test('fatal batch failure rolls back successful sensor mutations', async (t) => {
  const db = await createDatabase({ freshSchema: true })
  t.after(() => db.close())
  await db.exec(`
    alter table public.sensor_watchdog_state alter column connectivity_state drop not null;
    create function public.null_s05_connectivity() returns trigger language plpgsql as $$
    begin
      if exists (
        select 1 from public.sensors sensor
        where sensor.id = new.sensor_id and sensor.sensor_code = 'S-05'
      ) then
        new.connectivity_state := null;
      end if;
      return new;
    end;
    $$;
    create trigger null_s05_connectivity before update on public.sensor_watchdog_state
    for each row execute function public.null_s05_connectivity();
  `)

  await assert.rejects(evaluateCycle(db, 'observe'), /null value|field name must not be null/i)
  const { rows } = await db.query(`
    select count(*)::integer as evaluated
    from public.sensor_watchdog_state where last_evaluated_at is not null
  `)
  assert.equal(rows[0].evaluated, 0)
})

test('batch RPC validates inputs, is service-role-only, and preserves S-05 protection', async (t) => {
  const db = await createDatabase({ freshSchema: true })
  t.after(() => db.close())

  await assert.rejects(evaluateCycle(db, "observe' or '1'='1"), /Watchdog mode is invalid/)
  await db.exec('set role authenticated;')
  await assert.rejects(evaluateCycle(db), /permission denied/)
  await db.exec('reset role; set role service_role;')
  const result = await evaluateCycle(db, 'enforce')
  await db.exec('reset role;')

  const s05 = result.evaluations.find((item) => item.sensor_code === 'S-05')
  assert.equal(s05.succeeded, true)
  assert.equal(s05.detection_state, 'disabled')
  assert.deepEqual(s05.transition_descriptors, [])
  const downtime = await db.query('select count(*)::integer as count from public.downtime_events')
  assert.equal(downtime.rows[0].count, 0)
})
