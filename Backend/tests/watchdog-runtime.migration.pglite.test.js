const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const migration010 = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '010_create_machine_operational_settings.sql'),
  'utf8',
)
const migration011 = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '011_add_settings_history_and_watchdog_runtime.sql'),
  'utf8',
)
const migration013 = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '013_fix_heartbeat_digest_schema.sql'),
  'utf8',
)

const machineId = '10000000-0000-4000-8000-000000000001'
const actorId = '20000000-0000-4000-8000-000000000001'
const sensorIds = {
  'S-01': '30000000-0000-4000-8000-000000000001',
  'S-05': '30000000-0000-4000-8000-000000000005',
}
const bootId = '40000000-0000-4000-8000-000000000001'

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role;')
  return db
}

async function createLegacyDatabase(db) {
  await db.exec(`
    create schema if not exists extensions;
    create extension if not exists "pgcrypto" with schema extensions;
    create table public.users (id uuid primary key);
    create table public.machines (
      id uuid primary key,
      machine_code text not null unique
    );
    create table public.sensors (
      id uuid primary key,
      machine_id uuid not null references public.machines(id) on delete cascade,
      sensor_code text not null unique,
      esp32_device_id text not null unique
    );
    create table public.downtime_events (
      id uuid primary key default gen_random_uuid(),
      machine_id uuid not null references public.machines(id) on delete cascade,
      sensor_id uuid references public.sensors(id) on delete set null
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      user_id uuid references public.users(id) on delete set null,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    insert into public.users (id) values ('${actorId}');
    insert into public.machines (id, machine_code) values ('${machineId}', 'M-01');
  `)
  await db.exec(migration010)
  await db.exec(`
    insert into public.sensors (id, machine_id, sensor_code, esp32_device_id) values
      ('${sensorIds['S-01']}', '${machineId}', 'S-01', 'esp32-s01'),
      ('${sensorIds['S-05']}', '${machineId}', 'S-05', 'esp32-s05');
  `)
}

async function updateSettings(db, expectedVersion = '1') {
  const { rows: currentRows } = await db.query(`
    select sensor_thresholds, shift_schedule
    from public.machine_operational_settings
    where machine_id = '${machineId}'
  `)
  const thresholds = structuredClone(currentRows[0].sensor_thresholds)
  thresholds['S-01'].triggerSeconds += 60
  return db.query(
    `select * from public.update_machine_operational_settings(
      $1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5::uuid
    )`,
    [machineId, expectedVersion, JSON.stringify(thresholds), JSON.stringify(currentRows[0].shift_schedule), actorId],
  )
}

async function ingestHeartbeat(db, overrides = {}) {
  const values = {
    heartbeatId: '50000000-0000-4000-8000-000000000001',
    sensorId: sensorIds['S-01'],
    machineId,
    bootCounter: '1',
    bootId,
    sequence: '1',
    recordedAt: new Date().toISOString(),
    activityObserved: true,
    ...overrides,
  }
  return db.query(
    `select * from public.ingest_iot_heartbeat(
      $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, $6::bigint, $7::timestamptz, $8::boolean
    )`,
    [
      values.heartbeatId,
      values.sensorId,
      values.machineId,
      values.bootCounter,
      values.bootId,
      values.sequence,
      values.recordedAt,
      values.activityObserved,
    ],
  )
}

test('migrations 011 and 013 create runtime storage and are safe to reapply', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await db.exec(migration011)
  await db.exec(migration011)
  await db.exec(migration013)
  await db.exec(migration013)

  const { rows: history } = await db.query(`
    select version, effective_from, effective_to
    from public.machine_operational_settings_history
    where machine_id = '${machineId}'
  `)
  assert.equal(history.length, 1)
  assert.equal(Number(history[0].version), 1)
  assert.equal(history[0].effective_from, null)
  assert.equal(history[0].effective_to, null)

  const { rows: runtime } = await db.query(`
    select sensor_id, connectivity_state, detection_state, settings_version
    from public.sensor_watchdog_state order by sensor_id
  `)
  assert.equal(runtime.length, 2)
  assert.ok(runtime.every((row) => row.connectivity_state === 'unknown'))
  assert.ok(runtime.every((row) => row.detection_state === 'disabled'))
  assert.ok(runtime.every((row) => Number(row.settings_version) === 1))
})

test('migration 011 reconstructs complete Phase 2 audit history', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await updateSettings(db)
  await db.exec(migration011)

  const { rows } = await db.query(`
    select version, sensor_thresholds, effective_from, effective_to
    from public.machine_operational_settings_history
    where machine_id = '${machineId}' order by version
  `)
  assert.equal(rows.length, 2)
  assert.equal(Number(rows[0].version), 1)
  assert.equal(Number(rows[1].version), 2)
  assert.equal(rows[0].effective_to.toISOString(), rows[1].effective_from.toISOString())
  assert.equal(rows[0].sensor_thresholds['S-01'].triggerSeconds, 600)
  assert.equal(rows[1].sensor_thresholds['S-01'].triggerSeconds, 660)
  assert.equal(rows[1].effective_to, null)
})

test('migration 011 fails closed on malformed audit versions without partial tables', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await updateSettings(db)
  await db.exec(`
    update public.audit_logs
    set metadata = jsonb_set(metadata, '{current,version}', '"3"'::jsonb)
    where action = 'SETTINGS_UPDATED';
  `)

  await assert.rejects(db.exec(migration011), /Settings audit history is not contiguous/)
  await db.exec('rollback;')
  const { rows } = await db.query(`
    select count(*)::integer as count from information_schema.tables
    where table_schema = 'public' and table_name = 'sensor_watchdog_state'
  `)
  assert.equal(rows[0].count, 0)
})

test('history-aware settings RPC updates history and audit atomically while no-op stays quiet', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await db.exec(migration011)

  const { rows: current } = await db.query(`
    select sensor_thresholds, shift_schedule from public.machine_operational_settings
    where machine_id = '${machineId}'
  `)
  await db.query(
    `select * from public.update_machine_operational_settings(
      $1::uuid, 1, $2::jsonb, $3::jsonb, $4::uuid
    )`,
    [machineId, JSON.stringify(current[0].sensor_thresholds), JSON.stringify(current[0].shift_schedule), actorId],
  )
  let counts = await db.query(`
    select
      (select count(*) from public.machine_operational_settings_history)::integer as history_count,
      (select count(*) from public.audit_logs where action = 'SETTINGS_UPDATED')::integer as audit_count
  `)
  assert.deepEqual(counts.rows[0], { history_count: 1, audit_count: 0 })

  await updateSettings(db)
  counts = await db.query(`
    select
      (select count(*) from public.machine_operational_settings_history)::integer as history_count,
      (select count(*) from public.machine_operational_settings_history where effective_to is null)::integer as current_count,
      (select count(*) from public.audit_logs where action = 'SETTINGS_UPDATED')::integer as audit_count
  `)
  assert.deepEqual(counts.rows[0], { history_count: 2, current_count: 1, audit_count: 1 })
})

test('heartbeat RPC applies ordered packets and treats exact retry and older packets as no-ops', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await db.exec(migration011)

  await assert.rejects(
    ingestHeartbeat(db),
    /function digest\(bytea, unknown\) does not exist/,
  )
  await db.exec(migration013)

  const recordedAt = new Date().toISOString()
  const first = await ingestHeartbeat(db, { recordedAt })
  assert.equal(first.rows[0].state_applied, true)
  assert.equal(first.rows[0].connectivity_state, 'online')

  const duplicate = await ingestHeartbeat(db, { recordedAt })
  assert.equal(duplicate.rows[0].duplicate, true)
  assert.equal(duplicate.rows[0].state_applied, false)

  const second = await ingestHeartbeat(db, {
    heartbeatId: '50000000-0000-4000-8000-000000000002',
    sequence: '2',
    activityObserved: false,
  })
  assert.equal(second.rows[0].state_applied, true)

  const stale = await ingestHeartbeat(db, {
    heartbeatId: '50000000-0000-4000-8000-000000000003',
    sequence: '1',
  })
  assert.equal(stale.rows[0].stale, true)
  assert.equal(stale.rows[0].state_applied, false)

  const { rows: state } = await db.query(`
    select last_sequence, last_activity_received_at, last_device_recorded_at
    from public.sensor_watchdog_state where sensor_id = '${sensorIds['S-01']}'
  `)
  assert.equal(Number(state[0].last_sequence), 2)
  assert.ok(state[0].last_activity_received_at)
  assert.ok(state[0].last_device_recorded_at)
})

test('heartbeat RPC rejects conflicting sequence and boot identity but accepts a higher boot counter', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await db.exec(migration011)
  await db.exec(migration013)
  await ingestHeartbeat(db)

  await assert.rejects(
    ingestHeartbeat(db, {
      heartbeatId: '50000000-0000-4000-8000-000000000099',
      activityObserved: false,
    }),
    /Heartbeat sequence was reused with different content/,
  )
  await assert.rejects(
    ingestHeartbeat(db, {
      heartbeatId: '50000000-0000-4000-8000-000000000002',
      bootId: '40000000-0000-4000-8000-000000000002',
      sequence: '2',
    }),
    /Boot identity conflicts/,
  )

  const reboot = await ingestHeartbeat(db, {
    heartbeatId: '50000000-0000-4000-8000-000000000003',
    bootCounter: '2',
    bootId: '40000000-0000-4000-8000-000000000002',
    sequence: '1',
  })
  assert.equal(reboot.rows[0].state_applied, true)
})

test('heartbeat connectivity recovery needs two ordered packets and never enables S-05 detection', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await db.exec(migration011)
  await db.exec(migration013)
  await db.exec(`
    update public.sensor_watchdog_state
    set connectivity_state = 'offline', boot_counter = 1,
        boot_id = '${bootId}', last_sequence = 5,
        last_heartbeat_id = '50000000-0000-4000-8000-000000000005',
        last_heartbeat_payload_hash = 'old', last_heartbeat_received_at = now()
    where sensor_id = '${sensorIds['S-01']}';
  `)
  const first = await ingestHeartbeat(db, {
    heartbeatId: '50000000-0000-4000-8000-000000000006',
    sequence: '6',
  })
  assert.equal(first.rows[0].connectivity_state, 'offline')
  const second = await ingestHeartbeat(db, {
    heartbeatId: '50000000-0000-4000-8000-000000000007',
    sequence: '7',
  })
  assert.equal(second.rows[0].connectivity_state, 'online')

  await ingestHeartbeat(db, {
    heartbeatId: '50000000-0000-4000-8000-000000000008',
    sensorId: sensorIds['S-05'],
  })
  const { rows } = await db.query(`
    select detection_state from public.sensor_watchdog_state
    where sensor_id = '${sensorIds['S-05']}'
  `)
  assert.equal(rows[0].detection_state, 'disabled')
})

test('runtime tables deny direct client access and service-role mutation while RPC stays callable', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyDatabase(db)
  await db.exec(migration011)
  await db.exec(migration013)

  await db.exec('set role authenticated;')
  await assert.rejects(db.query('select * from public.sensor_watchdog_state'), /permission denied/)
  await assert.rejects(
    db.query(`select * from public.ingest_iot_heartbeat(
      gen_random_uuid(), '${sensorIds['S-01']}', '${machineId}', 1,
      gen_random_uuid(), 1, now(), true
    )`),
    /permission denied/,
  )
  await db.exec('reset role; set role service_role;')
  const { rows } = await db.query('select count(*)::integer as count from public.sensor_watchdog_state')
  assert.equal(rows[0].count, 2)
  await assert.rejects(
    db.query("update public.sensor_watchdog_state set connectivity_state = 'offline'"),
    /permission denied/,
  )
  await db.exec('reset role;')
})
