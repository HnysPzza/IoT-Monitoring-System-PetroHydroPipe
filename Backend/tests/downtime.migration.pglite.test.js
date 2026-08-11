const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '006_downtime_open_record_unique_index.sql'),
  'utf8',
)
const currentSchemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')

const legacySchemaSql = `
  create role anon;
  create role authenticated;
  create role service_role;
  create extension if not exists pgcrypto;

  create table public.machines (
    id uuid primary key default gen_random_uuid(),
    machine_code text not null unique,
    name text not null,
    status text not null default 'Idle',
    updated_at timestamptz not null default now()
  );

  create table public.sensors (
    id uuid primary key default gen_random_uuid(),
    machine_id uuid not null references public.machines(id) on delete cascade,
    sensor_code text not null unique,
    status text not null default 'Active',
    updated_at timestamptz not null default now()
  );

  create table public.sensor_events (
    id uuid primary key default gen_random_uuid(),
    sensor_id uuid not null references public.sensors(id) on delete cascade,
    machine_id uuid not null references public.machines(id) on delete cascade,
    event_type text not null,
    event_value jsonb not null default '{}'::jsonb,
    recorded_at timestamptz not null,
    created_at timestamptz not null default now()
  );

  create table public.downtime_events (
    id uuid primary key default gen_random_uuid(),
    machine_id uuid not null references public.machines(id) on delete cascade,
    sensor_id uuid references public.sensors(id) on delete set null,
    started_at timestamptz not null,
    ended_at timestamptz,
    duration_seconds integer,
    cause text,
    status text not null default 'Open' check (status in ('Open', 'Resolved')),
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint downtime_duration_non_negative check (duration_seconds is null or duration_seconds >= 0),
    constraint downtime_end_after_start check (ended_at is null or ended_at >= started_at)
  );
`

async function createLegacyDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(legacySchemaSql)
  return db
}

async function seedMachineAndSensors(db) {
  await db.exec(`
    insert into public.machines (id, machine_code, name, status)
    values ('11111111-1111-4111-8111-111111111111', 'M-01', 'Spiral Mill 01', 'Running');

    insert into public.sensors (id, machine_id, sensor_code, status) values
      ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'S-03', 'Active'),
      ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'S-04', 'Active');
  `)
}

async function ingest(db, {
  eventId,
  sensorId = '44444444-4444-4444-8444-444444444444',
  eventType,
  signal,
  recordedAt,
}) {
  const result = await db.query(`
    select * from public.ingest_iot_sensor_event(
      $1::uuid,
      $2::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      $3::text,
      $4::jsonb,
      $5::timestamptz
    )
  `, [eventId, sensorId, eventType, JSON.stringify({ signal, metadata: {} }), recordedAt])
  return result.rows[0]
}

test('migration 006 executes and enforces the full downtime lifecycle', async () => {
  const db = await createLegacyDatabase()

  try {
    await seedMachineAndSensors(db)
    await db.exec(`
      insert into public.sensor_events (
        id, sensor_id, machine_id, event_type, event_value, recorded_at
      ) values (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        'pulse',
        '{"signal":"active"}',
        now() - interval '10 minutes'
      );
    `)
    await db.exec(migrationSql)

    const backfilled = await db.query(`
      select id, device_event_id from public.sensor_events
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    `)
    assert.equal(backfilled.rows[0].device_event_id, backfilled.rows[0].id)

    const baseTime = Date.now() - (4 * 60 * 1000)
    const openedAt = new Date(baseTime).toISOString()
    const staleAt = new Date(baseTime - 60_000).toISOString()
    const recoveredAt = new Date(baseTime + 120_000).toISOString()
    const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

    const opened = await ingest(db, {
      eventId,
      eventType: 'downtime',
      signal: 'no_pulse',
      recordedAt: openedAt,
    })
    assert.equal(opened.state_applied, true)
    assert.equal(opened.downtime_action, 'created')
    assert.equal(opened.downtime_cause, 'Flux Refill')

    const duplicate = await ingest(db, {
      eventId,
      eventType: 'downtime',
      signal: 'no_pulse',
      recordedAt: openedAt,
    })
    assert.equal(duplicate.duplicate, true)
    assert.equal(duplicate.state_applied, false)

    await assert.rejects(
      () => ingest(db, {
        eventId,
        eventType: 'fault',
        signal: 'fault',
        recordedAt: openedAt,
      }),
      /Device event ID was reused with different event data/,
    )

    const stale = await ingest(db, {
      eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventType: 'recovered',
      signal: 'active',
      recordedAt: staleAt,
    })
    assert.equal(stale.stale, true)
    assert.equal(stale.state_applied, false)

    const recovered = await ingest(db, {
      eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      eventType: 'recovered',
      signal: 'active',
      recordedAt: recoveredAt,
    })
    assert.equal(recovered.downtime_action, 'resolved')
    assert.equal(recovered.downtime_duration_seconds, 120)

    const resolvedRows = await db.query(`
      select status, ended_at, duration_seconds from public.downtime_events
      where sensor_id = '44444444-4444-4444-8444-444444444444'
    `)
    assert.deepEqual(
      resolvedRows.rows.map((row) => ({ status: row.status, duration: row.duration_seconds })),
      [{ status: 'Resolved', duration: 120 }],
    )

    await assert.rejects(
      () => db.exec(`
        update public.downtime_events
        set status = 'Open'
        where sensor_id = '44444444-4444-4444-8444-444444444444';
      `),
      /downtime_state_fields_consistent/,
    )

    const manualOpened = await ingest(db, {
      eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      sensorId: '33333333-3333-4333-8333-333333333333',
      eventType: 'downtime',
      signal: 'no_pulse',
      recordedAt: new Date(baseTime + 180_000).toISOString(),
    })
    assert.equal(manualOpened.downtime_cause, 'Pending Cause Review')

    await db.query(`
      select * from public.update_downtime_record($1::uuid, 'Coil Joint', '', true, true)
    `, [manualOpened.downtime_id])
    const manualRecord = await db.query(`
      select cause, notes, status, ended_at, duration_seconds
      from public.downtime_events where id = $1::uuid
    `, [manualOpened.downtime_id])
    assert.equal(manualRecord.rows[0].cause, 'Coil Joint')
    assert.equal(manualRecord.rows[0].notes, '')
    assert.equal(manualRecord.rows[0].status, 'Resolved')
    assert.ok(manualRecord.rows[0].ended_at)
    assert.ok(manualRecord.rows[0].duration_seconds >= 0)

    const summary = await db.query(`
      select * from public.get_downtime_summary(null, null, null, null)
    `)
    assert.equal(Number(summary.rows[0].resolved_count), 2)

    const privileges = await db.query(`
      select
        has_function_privilege(
          'anon',
          'public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)',
          'EXECUTE'
        ) as anon_execute,
        has_function_privilege(
          'service_role',
          'public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)',
          'EXECUTE'
        ) as service_execute
    `)
    assert.equal(privileges.rows[0].anon_execute, false)
    assert.equal(privileges.rows[0].service_execute, true)
  } finally {
    await db.close()
  }
})

test('migration 006 blocks duplicate open downtime records without partial changes', async () => {
  const db = await createLegacyDatabase()

  try {
    await seedMachineAndSensors(db)
    await db.exec(`
      insert into public.downtime_events (machine_id, sensor_id, started_at, status) values
        ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', now() - interval '2 minutes', 'Open'),
        ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', now() - interval '1 minute', 'Open');
    `)

    await assert.rejects(() => db.exec(migrationSql), /resolve duplicate open downtime records/)
    await db.exec('rollback')

    const columnCheck = await db.query(`
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'sensor_events'
        and column_name = 'device_event_id'
    `)
    assert.equal(columnCheck.rows.length, 0)
  } finally {
    await db.close()
  }
})

test('the complete current schema executes in a clean PostgreSQL database', async () => {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })

  try {
    await db.exec('create role anon; create role authenticated; create role service_role;')
    await db.exec(currentSchemaSql)
    const functions = await db.query(`
      select routine_name
      from information_schema.routines
      where routine_schema = 'public'
        and routine_name in (
          'acknowledge_alert',
          'get_alerts_snapshot',
          'ingest_iot_sensor_event',
          'get_downtime_summary',
          'update_downtime_record'
        )
      order by routine_name
    `)

    assert.deepEqual(
      functions.rows.map((row) => row.routine_name),
      [
        'acknowledge_alert',
        'get_alerts_snapshot',
        'get_downtime_summary',
        'ingest_iot_sensor_event',
        'update_downtime_record',
      ],
    )
  } finally {
    await db.close()
  }
})
