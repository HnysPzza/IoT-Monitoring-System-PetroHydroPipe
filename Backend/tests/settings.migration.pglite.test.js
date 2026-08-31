const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const seedSql = fs.readFileSync(path.join(backendRoot, 'database', 'seed.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '010_create_machine_operational_settings.sql'),
  'utf8',
)

const machineId = '10000000-0000-4000-8000-000000000001'
const actorId = '20000000-0000-4000-8000-000000000001'

const expectedSensorThresholds = {
  'S-01': { absenceDetectionEnabled: false, triggerSeconds: 600, recoverySeconds: null },
  'S-02': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
  'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null },
  'S-04': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
  'S-05': { absenceDetectionEnabled: false, triggerSeconds: null, recoverySeconds: null },
}

const expectedShiftSchedule = {
  workStart: '08:00',
  workEnd: '17:00',
  breaks: [
    { name: 'Morning Break', startTime: '10:00', endTime: '10:15' },
    { name: 'Lunch Break', startTime: '12:00', endTime: '13:00' },
    { name: 'Afternoon Break', startTime: '15:00', endTime: '15:15' },
  ],
  rampUpGraceMinutes: 10,
}

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role;')
  return db
}

async function createLegacySchema(db, { includeMachine = true } = {}) {
  await db.exec(`
    create extension if not exists "pgcrypto";
    create table public.users (id uuid primary key);
    create table public.machines (
      id uuid primary key default gen_random_uuid(),
      machine_code text not null unique
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
  `)

  if (includeMachine) {
    await db.query(
      'insert into public.machines (id, machine_code) values ($1::uuid, $2)',
      [machineId, 'M-01'],
    )
  }
}

async function readSettings(db) {
  const { rows } = await db.query(`
    select machine_id, sensor_thresholds, shift_schedule, version, updated_by
    from public.machine_operational_settings
    where machine_id = '${machineId}'::uuid
  `)
  return rows[0]
}

test('migration 010 seeds M-01 defaults and is safe to reapply', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacySchema(db)

  await db.exec(migrationSql)
  await db.exec(migrationSql)

  const settings = await readSettings(db)
  assert.equal(settings.machine_id, machineId)
  assert.deepEqual(settings.sensor_thresholds, expectedSensorThresholds)
  assert.deepEqual(settings.shift_schedule, expectedShiftSchedule)
  assert.equal(Number(settings.version), 1)
  assert.equal(settings.updated_by, null)
})

test('settings RPC updates and audits atomically with optimistic concurrency', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacySchema(db)
  await db.exec(migrationSql)

  const changedThresholds = structuredClone(expectedSensorThresholds)
  changedThresholds['S-04'].triggerSeconds = 420

  const { rows } = await db.query(
    `select * from public.update_machine_operational_settings(
      $1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5::uuid
    )`,
    [machineId, '1', JSON.stringify(changedThresholds), JSON.stringify(expectedShiftSchedule), actorId],
  )

  assert.equal(Number(rows[0].version), 2)
  assert.equal(rows[0].updated_by, actorId)
  assert.equal(rows[0].sensor_thresholds['S-04'].triggerSeconds, 420)

  const { rows: audits } = await db.query(`
    select user_id, action, entity_type, entity_id, metadata
    from public.audit_logs
    where action = 'SETTINGS_UPDATED'
  `)
  assert.equal(audits.length, 1)
  assert.equal(audits[0].user_id, actorId)
  assert.equal(audits[0].entity_type, 'machine_settings')
  assert.equal(audits[0].entity_id, machineId)
  assert.deepEqual(audits[0].metadata.changedSections, ['sensorThresholds'])
  assert.equal(audits[0].metadata.previous.version, '1')
  assert.equal(audits[0].metadata.current.version, '2')

  await assert.rejects(
    db.query(
      `select * from public.update_machine_operational_settings(
        $1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5::uuid
      )`,
      [machineId, '1', JSON.stringify(expectedSensorThresholds), JSON.stringify(expectedShiftSchedule), actorId],
    ),
    /Settings version conflict/,
  )

  const afterConflict = await readSettings(db)
  assert.equal(Number(afterConflict.version), 2)
  assert.equal(afterConflict.sensor_thresholds['S-04'].triggerSeconds, 420)
})

test('settings RPC does not bump version or audit an unchanged payload', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacySchema(db)
  await db.exec(migrationSql)

  const { rows } = await db.query(
    `select * from public.update_machine_operational_settings(
      $1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5::uuid
    )`,
    [
      machineId,
      '1',
      JSON.stringify(expectedSensorThresholds),
      JSON.stringify(expectedShiftSchedule),
      actorId,
    ],
  )

  assert.equal(Number(rows[0].version), 1)
  const { rows: counts } = await db.query(
    "select count(*)::integer as count from public.audit_logs where action = 'SETTINGS_UPDATED'",
  )
  assert.equal(counts[0].count, 0)
})

test('settings and version roll back when audit insertion fails', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacySchema(db)
  await db.exec(migrationSql)
  await db.exec(`
    create function public.reject_settings_audit() returns trigger
    language plpgsql as $$
    begin
      if new.action = 'SETTINGS_UPDATED' then
        raise exception 'forced audit failure';
      end if;
      return new;
    end;
    $$;
    create trigger reject_settings_audit
    before insert on public.audit_logs
    for each row execute function public.reject_settings_audit();
  `)

  const changedSchedule = { ...expectedShiftSchedule, rampUpGraceMinutes: 15 }
  await assert.rejects(
    db.query(
      `select * from public.update_machine_operational_settings(
        $1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5::uuid
      )`,
      [
        machineId,
        '1',
        JSON.stringify(expectedSensorThresholds),
        JSON.stringify(changedSchedule),
        actorId,
      ],
    ),
    /forced audit failure/,
  )

  const settings = await readSettings(db)
  assert.equal(Number(settings.version), 1)
  assert.deepEqual(settings.shift_schedule, expectedShiftSchedule)
})

test('migration 010 fails closed when M-01 does not exist', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacySchema(db, { includeMachine: false })

  await assert.rejects(db.exec(migrationSql), /Machine M-01 not found/)
  await db.exec('rollback;')
  const { rows } = await db.query(`
    select count(*)::integer as count
    from information_schema.tables
    where table_schema = 'public' and table_name = 'machine_operational_settings'
  `)
  assert.equal(rows[0].count, 0)
})

test('settings storage denies direct client access and direct service-role updates', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacySchema(db)
  await db.exec(migrationSql)

  await db.exec('set role authenticated;')
  await assert.rejects(
    db.query('select * from public.machine_operational_settings'),
    /permission denied/,
  )
  await db.exec('reset role; set role service_role;')
  const { rows } = await db.query('select machine_id from public.machine_operational_settings')
  assert.deepEqual(rows, [{ machine_id: machineId }])
  await assert.rejects(
    db.query('update public.machine_operational_settings set version = version + 1'),
    /permission denied/,
  )
  await db.exec('reset role;')
})

test('fresh schema and seed provide the same M-01 settings defaults', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(schemaSql)
  await db.exec(seedSql)

  const { rows } = await db.query(`
    select settings.sensor_thresholds, settings.shift_schedule, settings.version, settings.updated_by
    from public.machine_operational_settings settings
    join public.machines machine on machine.id = settings.machine_id
    where machine.machine_code = 'M-01'
  `)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].sensor_thresholds, expectedSensorThresholds)
  assert.deepEqual(rows[0].shift_schedule, expectedShiftSchedule)
  assert.equal(Number(rows[0].version), 1)
  assert.equal(rows[0].updated_by, null)
})
