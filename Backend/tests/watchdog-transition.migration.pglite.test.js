const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const seedSql = fs.readFileSync(path.join(backendRoot, 'database', 'seed.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '012_add_atomic_watchdog_transitions.sql'),
  'utf8',
)
const noPulseFixMigrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '023_route_no_pulse_through_watchdog.sql'),
  'utf8',
)
const s05ProtectionMigrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '025_prevent_s05_downtime.sql'),
  'utf8',
)

const actorId = '20000000-0000-4000-8000-000000000099'

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(schemaSql)
  await db.exec(seedSql)
  await db.exec(`insert into public.users (id, role_id, name, username, password_hash)
    select '${actorId}', id, 'Test Actor', 'watchdog-test', 'hash' from public.roles where name = 'Admin';`)
  return db
}

async function getIds(db, sensorCode = 'S-01') {
  const { rows } = await db.query(`
    select sensor.id as sensor_id, sensor.machine_id
    from public.sensors sensor where sensor.sensor_code = $1
  `, [sensorCode])
  return rows[0]
}

async function enableSensor(db, sensorCode = 'S-01', triggerSeconds = 60, recoverySeconds = 30) {
  const ids = await getIds(db, sensorCode)
  const { rows } = await db.query(`
    select sensor_thresholds, shift_schedule, version
    from public.machine_operational_settings where machine_id = $1
  `, [ids.machine_id])
  const thresholds = structuredClone(rows[0].sensor_thresholds)
  thresholds[sensorCode] = { absenceDetectionEnabled: true, triggerSeconds, recoverySeconds }
  await db.query(
    `select * from public.update_machine_operational_settings(
      $1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5::uuid
    )`,
    [ids.machine_id, String(rows[0].version), JSON.stringify(thresholds), JSON.stringify(rows[0].shift_schedule), actorId],
  )
  return ids
}

async function setRuntime(db, sensorId, overrides = {}) {
  const defaults = {
    lastHeartbeat: '2026-08-21T00:00:00Z',
    lastActivity: '2026-08-21T00:00:00Z',
    connectivity: 'online',
    detection: 'healthy',
    baseline: null,
    recoveryStarted: null,
    recoveryCount: 0,
  }
  const state = { ...defaults, ...overrides }
  await db.exec('alter table public.sensor_watchdog_state disable trigger track_watchdog_recovery_observation;')
  await db.query(`
    update public.sensor_watchdog_state set
      last_heartbeat_received_at = $2::timestamptz,
      last_heartbeat_id = coalesce(last_heartbeat_id, gen_random_uuid()),
      last_heartbeat_payload_hash = coalesce(last_heartbeat_payload_hash, 'test'),
      boot_counter = coalesce(boot_counter, 1),
      boot_id = coalesce(boot_id, gen_random_uuid()),
      last_sequence = coalesce(last_sequence, 1),
      last_activity_received_at = $3::timestamptz,
      connectivity_state = $4,
      detection_state = $5,
      absence_baseline_at = $6::timestamptz,
      recovery_started_at = $7::timestamptz,
      recovery_observation_count = $8::integer
    where sensor_id = $1::uuid
  `, [
    sensorId,
    state.lastHeartbeat,
    state.lastActivity,
    state.connectivity,
    state.detection,
    state.baseline,
    state.recoveryStarted,
    state.recoveryCount,
  ])
  await db.exec('alter table public.sensor_watchdog_state enable trigger track_watchdog_recovery_observation;')
}

async function evaluate(db, sensorId, evaluatedAt, mode = 'enforce', staleSeconds = 30) {
  return db.query(
    'select * from public.evaluate_sensor_watchdog($1::uuid, $2::timestamptz, $3, $4)',
    [sensorId, evaluatedAt, mode, staleSeconds],
  )
}

test('migration 012 is additive, backfills event ownership, and is safe to reapply', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  const ids = await getIds(db)
  await db.query(`insert into public.downtime_events
    (machine_id, sensor_id, started_at, cause, status, notes)
    values ($1, $2, '2026-08-21T00:00:00Z', 'Corrective Maintenance', 'Open', '')`,
  [ids.machine_id, ids.sensor_id])

  await db.exec(migrationSql)
  await db.exec(migrationSql)
  const { rows } = await db.query(`
    select detection_source, settings_version from public.downtime_events
  `)
  assert.deepEqual(rows, [{ detection_source: 'sensor_event', settings_version: null }])
  assert.ok(await db.query("select to_regprocedure('public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)') as rpc"))
})

test('database operational time returns 420 minutes and exact break-crossing threshold', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await getIds(db)
  const { rows } = await db.query(`
    select
      public.watchdog_eligible_seconds($1, '2026-08-21T16:00:00Z', '2026-08-22T16:00:00Z') as seconds,
      public.watchdog_advance_eligible_time(
        $1, '2026-08-21T01:55:00Z', '2026-08-21T03:00:00Z', 600
      ) as reached_at
  `, [ids.machine_id])
  assert.equal(Number(rows[0].seconds), 420 * 60)
  assert.equal(rows[0].reached_at.toISOString(), '2026-08-21T02:30:00.000Z')
})

test('observe mode records the candidate threshold without operational mutations', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db)
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:01:55Z',
    lastActivity: '2026-08-21T00:00:00Z',
  })

  const result = await evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z', 'observe', 30)
  assert.equal(result.rows[0].detection_state, 'downtime')
  assert.deepEqual(result.rows[0].transition_descriptors, [])
  const { rows } = await db.query(`
    select
      (select count(*) from public.downtime_events)::integer as downtime_count,
      (select count(*) from public.alerts)::integer as alert_count,
      (select status from public.sensors where id = $1) as sensor_status,
      (select count(*) from public.sensor_watchdog_transitions)::integer as transition_count
  `, [ids.sensor_id])
  assert.deepEqual(rows[0], {
    downtime_count: 0,
    alert_count: 0,
    sensor_status: 'Active',
    transition_count: 1,
  })
})

test('enforce mode creates exactly one atomic downtime at the threshold crossing', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db)
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:01:55Z',
    lastActivity: '2026-08-21T00:00:00Z',
  })

  const first = await evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z')
  assert.equal(first.rows[0].detection_state, 'downtime')
  assert.equal(first.rows[0].transition_descriptors.length, 2)
  await evaluate(db, ids.sensor_id, '2026-08-21T00:02:05Z')

  const { rows } = await db.query(`
    select downtime.started_at, downtime.detection_source, downtime.settings_version,
      downtime.status, sensor.status as sensor_status, machine.status as machine_status
    from public.downtime_events downtime
    join public.sensors sensor on sensor.id = downtime.sensor_id
    join public.machines machine on machine.id = downtime.machine_id
  `)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T00:01:00.000Z')
  assert.equal(rows[0].detection_source, 'absence_watchdog')
  assert.equal(Number(rows[0].settings_version), 2)
  assert.equal(rows[0].status, 'Open')
  assert.equal(rows[0].sensor_status, 'Fault')
  assert.equal(rows[0].machine_status, 'Downtime')
})

test('stale connectivity suspends detection and cannot create production downtime', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db)
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:00:00Z',
    lastActivity: '2026-08-21T00:00:00Z',
  })

  const result = await evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z')
  assert.equal(result.rows[0].connectivity_state, 'offline')
  assert.equal(result.rows[0].detection_state, 'suspended')
  const { rows } = await db.query(`
    select
      (select count(*) from public.downtime_events)::integer as downtime_count,
      (select count(*) from public.alerts where source_type = 'sensor_connectivity')::integer as connectivity_alerts
  `)
  assert.deepEqual(rows[0], { downtime_count: 0, connectivity_alerts: 1 })
})

test('break and post-break grace reset pre-trigger accumulation', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db, 'S-01', 120, 30)
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T02:19:55Z',
    lastActivity: '2026-08-21T01:59:00Z',
    detection: 'grace',
    baseline: '2026-08-21T01:59:00Z',
  })

  const noPulse = await db.query(`select * from public.ingest_iot_sensor_event(
    gen_random_uuid(), $1, $2, 'downtime', '{"signal":"no_pulse"}', '2026-08-21T02:10:00Z'
  )`, [ids.sensor_id, ids.machine_id])
  assert.equal(noPulse.rows[0].downtime_action, null)
  let count = await db.query('select count(*)::integer as count from public.downtime_events')
  assert.equal(count.rows[0].count, 0)

  const duringGrace = await evaluate(db, ids.sensor_id, '2026-08-21T02:20:00Z')
  assert.equal(duringGrace.rows[0].detection_state, 'suspended')
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T02:25:55Z',
    lastActivity: '2026-08-21T01:59:00Z',
    detection: 'suspended',
  })
  const afterGrace = await evaluate(db, ids.sensor_id, '2026-08-21T02:26:00Z')
  assert.equal(afterGrace.rows[0].detection_state, 'grace')
  count = await db.query('select count(*)::integer as count from public.downtime_events')
  assert.equal(count.rows[0].count, 0)
})

test('explicit physical fault during a planned break remains recorded', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db, 'S-01', 120, 30)

  const fault = await db.query(`select * from public.ingest_iot_sensor_event(
    gen_random_uuid(), $1, $2, 'fault', '{"signal":"fault"}', '2026-08-21T02:05:00Z'
  )`, [ids.sensor_id, ids.machine_id])

  assert.equal(fault.rows[0].downtime_action, 'created')
  const { rows } = await db.query(`
    select started_at, detection_source, status from public.downtime_events
  `)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T02:05:00.000Z')
  assert.equal(rows[0].detection_source, 'sensor_event')
  assert.equal(rows[0].status, 'Open')
})

test('enabled no-pulse observation cannot bypass threshold while explicit fault remains immediate', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db, 'S-01', 600, 30)

  const noPulseId = '50000000-0000-4000-8000-000000000011'
  const faultId = '50000000-0000-4000-8000-000000000012'
  const noPulse = await db.query(`select * from public.ingest_iot_sensor_event(
    $1, $2, $3, 'downtime', '{"signal":"no_pulse"}', '2026-08-21T00:00:00Z'
  )`, [noPulseId, ids.sensor_id, ids.machine_id])
  assert.equal(noPulse.rows[0].state_applied, true)
  assert.equal(noPulse.rows[0].downtime_action, null)

  const fault = await db.query(`select * from public.ingest_iot_sensor_event(
    $1, $2, $3, 'fault', '{"signal":"fault"}', '2026-08-21T00:01:00Z'
  )`, [faultId, ids.sensor_id, ids.machine_id])
  assert.equal(fault.rows[0].downtime_action, 'created')
  const { rows } = await db.query('select detection_source from public.downtime_events')
  assert.deepEqual(rows, [{ detection_source: 'sensor_event' }])
})

test('disabled no-pulse ingestion remains observational during production and a planned break', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  await db.exec(noPulseFixMigrationSql)
  await db.exec(noPulseFixMigrationSql)
  const ids = await getIds(db, 'S-01')

  const observations = [
    ['50000000-0000-4000-8000-000000000021', '2026-08-21T01:00:00Z'],
    ['50000000-0000-4000-8000-000000000022', '2026-08-21T02:05:00Z'],
  ]
  for (const [eventId, recordedAt] of observations) {
    const result = await db.query(`select * from public.ingest_iot_sensor_event(
      $1, $2, $3, 'downtime', '{"signal":"no_pulse"}', $4
    )`, [eventId, ids.sensor_id, ids.machine_id, recordedAt])
    assert.equal(result.rows[0].state_applied, true)
    assert.equal(result.rows[0].downtime_action, null)
    assert.equal(result.rows[0].alert_action, null)
  }

  const duplicate = await db.query(`select * from public.ingest_iot_sensor_event(
    $1, $2, $3, 'downtime', '{"signal":"no_pulse"}', $4
  )`, [observations[0][0], ids.sensor_id, ids.machine_id, observations[0][1]])
  assert.equal(duplicate.rows[0].duplicate, true)
  assert.equal(duplicate.rows[0].state_applied, false)

  const stale = await db.query(`select * from public.ingest_iot_sensor_event(
    '50000000-0000-4000-8000-000000000023', $1, $2,
    'downtime', '{"signal":"no_pulse"}', '2026-08-21T00:59:00Z'
  )`, [ids.sensor_id, ids.machine_id])
  assert.equal(stale.rows[0].stale, true)
  assert.equal(stale.rows[0].state_applied, false)

  const { rows } = await db.query(`
    select
      (select count(*) from public.sensor_events)::integer as event_count,
      (select count(*) from public.downtime_events)::integer as downtime_count,
      (select count(*) from public.alerts)::integer as alert_count
  `)
  assert.deepEqual(rows[0], { event_count: 3, downtime_count: 0, alert_count: 0 })

  await db.exec('set role authenticated;')
  await assert.rejects(
    db.query(`select * from public.ingest_iot_sensor_event(
      gen_random_uuid(), $1, $2, 'downtime', '{"signal":"no_pulse"}', '2026-08-21T03:00:00Z'
    )`, [ids.sensor_id, ids.machine_id]),
    /permission denied/,
  )
  await db.exec('reset role;')
})

test('S-05 no-pulse ingestion remains raw history without downtime or alerts', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  const ids = await getIds(db, 'S-05')

  const result = await db.query(`select * from public.ingest_iot_sensor_event(
    gen_random_uuid(), $1, $2, 'downtime', '{"signal":"no_pulse"}', '2026-08-21T01:00:00Z'
  )`, [ids.sensor_id, ids.machine_id])
  assert.equal(result.rows[0].state_applied, true)
  assert.equal(result.rows[0].downtime_action, null)
  assert.equal(result.rows[0].alert_action, null)

  const { rows } = await db.query(`
    select
      (select count(*) from public.sensor_events)::integer as event_count,
      (select count(*) from public.downtime_events)::integer as downtime_count,
      (select count(*) from public.alerts)::integer as alert_count
  `)
  assert.deepEqual(rows[0], { event_count: 1, downtime_count: 0, alert_count: 0 })
})

test('S-05 explicit fault remains raw history without downtime, alerts, or operational state changes', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(s05ProtectionMigrationSql)
  await db.exec(s05ProtectionMigrationSql)
  const ids = await getIds(db, 'S-05')

  const result = await db.query(`select * from public.ingest_iot_sensor_event(
    gen_random_uuid(), $1, $2, 'fault', '{"signal":"fault"}', '2026-08-21T01:00:00Z'
  )`, [ids.sensor_id, ids.machine_id])
  assert.equal(result.rows[0].state_applied, true)
  assert.equal(result.rows[0].downtime_action, null)
  assert.equal(result.rows[0].alert_action, null)

  const { rows } = await db.query(`
    select
      (select count(*) from public.sensor_events)::integer as event_count,
      (select count(*) from public.downtime_events)::integer as downtime_count,
      (select count(*) from public.alerts)::integer as alert_count,
      (select status from public.sensors where id = $1) as sensor_status,
      (select status from public.machines where id = $2) as machine_status
  `, [ids.sensor_id, ids.machine_id])
  assert.deepEqual(rows[0], {
    event_count: 1,
    downtime_count: 0,
    alert_count: 0,
    sensor_status: 'Active',
    machine_status: 'Idle',
  })
})

test('database rejects new S-05 downtime rows at the table boundary', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  const ids = await getIds(db, 'S-05')

  await assert.rejects(
    db.query(`insert into public.downtime_events
      (machine_id, sensor_id, started_at, cause, status)
      values ($1, $2, '2026-08-21T01:00:00Z', 'Manual Cutting', 'Open')`,
    [ids.machine_id, ids.sensor_id]),
    /S-05 cannot create downtime records/,
  )

  await db.exec('alter table public.downtime_events disable trigger prevent_s05_downtime;')
  const historical = await db.query(`insert into public.downtime_events
    (machine_id, sensor_id, started_at, cause, status)
    values ($1, $2, '2026-08-20T01:00:00Z', 'Manual Cutting', 'Open')
    returning id`, [ids.machine_id, ids.sensor_id])
  await db.exec('alter table public.downtime_events enable trigger prevent_s05_downtime;')

  await db.query(`update public.downtime_events
    set sensor_id = sensor_id, status = 'Resolved',
      ended_at = '2026-08-20T01:05:00Z', duration_seconds = 300
    where id = $1`, [historical.rows[0].id])
  const resolved = await db.query(
    'select status, duration_seconds from public.downtime_events where id = $1',
    [historical.rows[0].id],
  )
  assert.deepEqual(resolved.rows, [{ status: 'Resolved', duration_seconds: 300 }])
})

test('one recovered event cannot resolve watchdog-created downtime and sustained recovery resolves once', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db)
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:01:55Z',
    lastActivity: '2026-08-21T00:00:00Z',
  })
  await evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z')

  const recovered = await db.query(`select * from public.ingest_iot_sensor_event(
    gen_random_uuid(), $1, $2, 'recovered', '{"signal":"active"}', '2026-08-21T00:02:10Z'
  )`, [ids.sensor_id, ids.machine_id])
  assert.equal(recovered.rows[0].downtime_action, null)
  let state = await db.query('select status from public.downtime_events')
  assert.equal(state.rows[0].status, 'Open')

  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:03:00Z',
    lastActivity: '2026-08-21T00:02:10Z',
    connectivity: 'online',
    detection: 'recovering',
    baseline: '2026-08-21T00:00:00Z',
    recoveryStarted: '2026-08-21T00:02:10Z',
    recoveryCount: 2,
  })
  const resolved = await evaluate(db, ids.sensor_id, '2026-08-21T00:02:40Z')
  assert.equal(resolved.rows[0].detection_state, 'healthy')
  state = await db.query('select status, ended_at from public.downtime_events')
  assert.equal(state.rows[0].status, 'Resolved')
  assert.equal(state.rows[0].ended_at.toISOString(), '2026-08-21T00:02:40.000Z')
})

test('settings disablement never auto-resolves an existing watchdog incident', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db)
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:01:55Z',
    lastActivity: '2026-08-21T00:00:00Z',
  })
  await evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z')

  const { rows: current } = await db.query(`
    select sensor_thresholds, shift_schedule, version from public.machine_operational_settings
    where machine_id = $1
  `, [ids.machine_id])
  const thresholds = structuredClone(current[0].sensor_thresholds)
  thresholds['S-01'] = { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: 30 }
  await db.query(`select * from public.update_machine_operational_settings(
    $1, $2, $3, $4, $5
  )`, [
    ids.machine_id,
    String(current[0].version),
    JSON.stringify(thresholds),
    JSON.stringify(current[0].shift_schedule),
    actorId,
  ])
  const result = await evaluate(db, ids.sensor_id, '2026-08-21T00:02:10Z')
  assert.equal(result.rows[0].detection_state, 'disabled')
  const downtime = await db.query('select status from public.downtime_events')
  assert.equal(downtime.rows[0].status, 'Open')
})

test('audit failure rolls back the complete enforced transition', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await enableSensor(db)
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:01:55Z',
    lastActivity: '2026-08-21T00:00:00Z',
  })
  await db.exec(`
    create function public.reject_watchdog_audit() returns trigger language plpgsql as $$
    begin
      if new.action = 'WATCHDOG_DOWNTIME_CREATED' then raise exception 'forced watchdog audit failure'; end if;
      return new;
    end; $$;
    create trigger reject_watchdog_audit before insert on public.audit_logs
    for each row execute function public.reject_watchdog_audit();
  `)

  await assert.rejects(
    evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z'),
    /forced watchdog audit failure/,
  )
  const { rows } = await db.query(`
    select
      (select count(*) from public.downtime_events)::integer as downtime_count,
      (select count(*) from public.alerts)::integer as alert_count,
      (select status from public.sensors where id = $1) as sensor_status,
      (select detection_state from public.sensor_watchdog_state where sensor_id = $1) as detection_state
  `, [ids.sensor_id])
  assert.deepEqual(rows[0], {
    downtime_count: 0,
    alert_count: 0,
    sensor_status: 'Active',
    detection_state: 'healthy',
  })
})

test('S-05 and disabled mode cannot create candidate or operational downtime', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await getIds(db, 'S-05')
  await setRuntime(db, ids.sensor_id, {
    lastHeartbeat: '2026-08-21T00:01:55Z',
    lastActivity: '2026-08-21T00:00:00Z',
  })
  const output = await evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z', 'enforce')
  assert.equal(output.rows[0].detection_state, 'disabled')
  const disabled = await evaluate(db, ids.sensor_id, '2026-08-21T00:03:00Z', 'disabled')
  assert.deepEqual(disabled.rows[0].transition_descriptors, [])
  const count = await db.query('select count(*)::integer as count from public.downtime_events')
  assert.equal(count.rows[0].count, 0)
})

test('watchdog RPC is service-role-only and direct runtime mutation stays denied', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(migrationSql)
  const ids = await getIds(db)
  await db.exec('set role authenticated;')
  await assert.rejects(
    evaluate(db, ids.sensor_id, '2026-08-21T00:02:00Z', 'observe'),
    /permission denied/,
  )
  await db.exec('reset role; set role service_role;')
  await assert.rejects(
    db.query("update public.sensor_watchdog_state set detection_state = 'healthy'"),
    /permission denied/,
  )
  await db.exec('reset role;')
})
