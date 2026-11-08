const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { randomUUID } = require('node:crypto')
const databaseRoot = path.resolve(__dirname, '../../database')
const releaseSchemaVersion = 57

async function database(t, migrationEnd = releaseSchemaVersion) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= migrationEnd
    })
    .sort()
    .map((name) => fs.readFileSync(path.join(databaseRoot, 'migrations', name), 'utf8'))
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, must_change_password, role_id)
    select 'Release Admin', 'release-admin', 'hash', false, id from roles where name = 'Admin'`)
  for (const migration of migrations) await db.exec(migration)
  return db
}

test('full migration chain reports release readiness version 52 and five roles', async (t) => {
  const db = await database(t)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, releaseSchemaVersion)
  assert.deepEqual(
    (await db.query('select name from roles order by name')).rows.map(({ name }) => name),
    ['Admin', 'Engineering Supervisor', 'Operation Manager', 'Production Supervisor', 'Quality Control'],
  )
})

test('role rename migration 052 transitions Asst. Operation Manager accounts to Quality Control', async (t) => {
  const db = await database(t, 51)
  await db.query("update roles set name = 'Asst. Operation Manager' where name = 'Quality Control'")
  const assistantUser = await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Test Assistant', 'test-assistant', 'hash', id from roles where name = 'Asst. Operation Manager'
    returning id`)

  const migration = fs.readFileSync(path.join(databaseRoot, 'migrations', '052_replace_assistant_with_quality_control.sql'), 'utf8')
  await db.exec(migration)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 52)
  const updatedUserRole = await db.query(
    'select r.name from users u join roles r on r.id = u.role_id where u.id = $1',
    [assistantUser.rows[0].id],
  )
  assert.equal(updatedUserRole.rows[0].name, 'Quality Control')
})

test('password reset migration remains repeatable before role consolidation', async (t) => {
  const db = await database(t, 45)
  const migration = fs.readFileSync(path.join(databaseRoot, 'migrations', '045_user_password_reset.sql'), 'utf8')

  await db.exec(migration)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 45)
  assert.equal((await db.query(`select count(*)::int as count from pg_attribute
    where attrelid='public.password_setup_tokens'::regclass and attname='purpose' and not attisdropped`)).rows[0].count, 1)
})

test('role consolidation migration can be reapplied without lowering readiness', async (t) => {
  const db = await database(t, 46)
  const migration = fs.readFileSync(path.join(databaseRoot, 'migrations', '046_consolidate_managing_director_role.sql'), 'utf8')

  await db.exec(migration)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 46)
  assert.equal((await db.query("select count(*)::int as count from roles where name = 'Managing Director'")).rows[0].count, 0)
})

test('role consolidation stops without changing accounts when Managing Director is assigned', async (t) => {
  const db = await database(t, 45)
  await db.query("insert into roles(name, description) values ('Managing Director', 'Legacy role')")
  const legacyAccount = await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Legacy Director', 'legacy-director', 'hash', id from roles where name = 'Managing Director'
    returning id`)
  const migration = fs.readFileSync(path.join(databaseRoot, 'migrations', '046_consolidate_managing_director_role.sql'), 'utf8')

  await assert.rejects(db.exec(migration), /Managing Director role is assigned to a user account/i)
  await db.exec('rollback')

  assert.equal((await db.query("select count(*)::int as count from roles where name = 'Managing Director'")).rows[0].count, 1)
  assert.equal((await db.query("select count(*)::int as count from users where id = $1 and role_id = (select id from roles where name = 'Managing Director')", [legacyAccount.rows[0].id])).rows[0].count, 1)
})

test('role consolidation stops without deleting an unrecognized role', async (t) => {
  const db = await database(t, 45)
  await db.query("insert into roles(name, description) values ('Managing Director', 'Legacy role'), ('Custom Role', 'Do not delete')")
  const migration = fs.readFileSync(path.join(databaseRoot, 'migrations', '046_consolidate_managing_director_role.sql'), 'utf8')

  await assert.rejects(db.exec(migration), /Expected role catalog of five roles/i)
  await db.exec('rollback')

  assert.equal((await db.query('select count(*)::int as count from roles')).rows[0].count, 7)
  assert.equal((await db.query("select count(*)::int as count from roles where name = 'Managing Director'")).rows[0].count, 1)
})

test('release readiness stays limited to the service role', async (t) => {
  const db = await database(t)

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role};`)
    await assert.rejects(db.query('select public.get_backend_readiness()'), /permission denied/i)
    await db.exec('reset role;')
  }

  await db.exec('set role service_role;')
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, releaseSchemaVersion)
})

test('release readiness fails when the watchdog evaluator is missing', async (t) => {
  const db = await database(t)
  await db.exec('drop function public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer);')

  await assert.rejects(db.query('select public.get_backend_readiness()'), /required database dependencies are missing/i)
})

test('release readiness fails when an unexpected role is added after migration', async (t) => {
  const db = await database(t)
  await db.query("insert into roles(name, description) values ('Custom Role', 'Unexpected role')")

  await assert.rejects(db.query('select public.get_backend_readiness()'), /role catalog does not match the expected five roles/i)
})

test('Admin can issue a cooldown-limited reset link only for an active completed account', async (t) => {
  const db = await database(t)
  const adminId = (await db.query("select id from users where username='release-admin'")).rows[0].id
  const passwordHash = '$2b$10$' + 'a'.repeat(53)
  const targetId = (await db.query(`insert into users(name,username,email,password_hash,role_id)
    select 'Reset Target','reset-target','reset@example.test',$1,id from roles where name='Operation Manager'
    returning id`, [passwordHash])).rows[0].id
  const firstTokenHash = 'd'.repeat(64)

  await db.query('select public.request_user_password_reset($1,$2,$3)', [adminId, targetId, firstTokenHash])

  const token = (await db.query('select purpose,token_hash,used_at from password_setup_tokens where user_id=$1', [targetId])).rows[0]
  assert.deepEqual(token, { purpose: 'reset', token_hash: firstTokenHash, used_at: null })
  await assert.rejects(
    db.query('select public.request_user_password_reset($1,$2,$3)', [targetId, targetId, 'e'.repeat(64)]),
    /Admin access required/,
  )
  await assert.rejects(
    db.query('select public.request_user_password_reset($1,$2,$3)', [adminId, adminId, 'e'.repeat(64)]),
    /Account is not eligible for password reset/,
  )
  await assert.rejects(
    db.query('select public.request_user_password_reset($1,$2,$3)', [adminId, targetId, 'e'.repeat(64)]),
    /Wait one minute/,
  )

  const requestAudit = (await db.query(`select user_id,action from audit_logs
    where entity_id=$1 and action='USER_PASSWORD_RESET_REQUESTED'`, [targetId])).rows[0]
  assert.deepEqual(requestAudit, { user_id: adminId, action: 'USER_PASSWORD_RESET_REQUESTED' })
})

test('reset completion changes password once and revokes existing sessions', async (t) => {
  const db = await database(t)
  const adminId = (await db.query("select id from users where username='release-admin'")).rows[0].id
  const oldHash = '$2b$10$' + 'a'.repeat(53)
  const newHash = '$2b$10$' + 'b'.repeat(53)
  const targetId = (await db.query(`insert into users(name,username,email,password_hash,role_id)
    select 'Reset Target','reset-target','reset@example.test',$1,id from roles where name='Operation Manager'
    returning id`, [oldHash])).rows[0].id

  await db.query('select public.request_user_password_reset($1,$2,$3)', [adminId, targetId, 'f'.repeat(64)])
  await db.query("select public.issue_refresh_token($1,$2,now()+interval '1 hour')", [targetId, 'e'.repeat(64)])
  await db.query('select public.complete_password_setup($1,$2)', ['f'.repeat(64), newHash])

  const account = (await db.query('select password_hash,onboarding_state,must_change_password from users where id=$1', [targetId])).rows[0]
  assert.deepEqual(account, { password_hash: newHash, onboarding_state: 'Ready', must_change_password: false })
  assert.ok((await db.query('select revoked_at from auth_sessions where user_id=$1', [targetId])).rows[0].revoked_at)
  assert.ok((await db.query('select revoked_at from refresh_tokens where user_id=$1', [targetId])).rows[0].revoked_at)
  assert.ok((await db.query('select used_at from password_setup_tokens where token_hash=$1', ['f'.repeat(64)])).rows[0].used_at)
  assert.equal((await db.query(`select count(*)::int as count from audit_logs
    where entity_id=$1 and action='PASSWORD_RESET_COMPLETED'`, [targetId])).rows[0].count, 1)
  await assert.rejects(db.query('select public.complete_password_setup($1,$2)', ['f'.repeat(64), newHash]), /Invalid or expired password link/)
})

test('migration 053 adds editable tonnage to production_item_specs and supports single and batch RPC overrides', async (t) => {
  const db = await database(t)
  const machineId = (await db.query("select id from machines where machine_code = 'M-01'")).rows[0].id
  const sensorId = (await db.query("select id from sensors where sensor_code = 'S-05'")).rows[0].id
  const adminId = (await db.query("select id from users where username = 'release-admin'")).rows[0].id

  const evt1 = (await db.query(`
    insert into sensor_events (machine_id, sensor_id, event_type, output_accepted, recorded_at)
    values ($1, $2, 'pulse', true, now() - interval '20 minutes')
    returning id
  `, [machineId, sensorId])).rows[0].id

  const evt2 = (await db.query(`
    insert into sensor_events (machine_id, sensor_id, event_type, output_accepted, recorded_at)
    values ($1, $2, 'pulse', true, now() - interval '10 minutes')
    returning id
  `, [machineId, sensorId])).rows[0].id

  // 1. Single update with explicit p_tonnage override
  const singleRes = await db.query(`
    select * from public.update_production_log_spec(
      p_sensor_event_id := $1,
      p_customer := 'MCWD',
      p_diameter := 625.4,
      p_thickness := 12.7,
      p_length := 6000,
      p_pipe_number := 101,
      p_actor_user_id := $2,
      p_expected_updated_at := null,
      p_tonnage := 1.2500
    )
  `, [evt1, adminId])
  assert.equal(Number(singleRes.rows[0].tonnage), 1.25)

  // 2. Batch update with p_tonnage override
  const batchRes = await db.query(`
    select * from public.batch_update_production_log_specs(
      p_sensor_event_ids := $1,
      p_customer := 'Batch Client',
      p_tonnage := 2.7500,
      p_actor_user_id := $2
    )
  `, [[evt1, evt2], adminId])
  assert.equal(batchRes.rows[0].updated_count, 2)

  const specs = (await db.query('select sensor_event_id, customer, tonnage, pipe_number from production_item_specs where sensor_event_id = any($1) order by sensor_event_id', [[evt1, evt2]])).rows
  assert.equal(specs.length, 2)
  const spec1 = specs.find((s) => s.sensor_event_id === evt1)
  const spec2 = specs.find((s) => s.sensor_event_id === evt2)
  assert.equal(Number(spec1.tonnage), 2.75)
  assert.equal(spec1.pipe_number, 101)
  assert.equal(Number(spec2.tonnage), 2.75)

  // 3. Batch update changing dimensions without p_tonnage resets manual tonnage override to null so formula takes over
  await db.query(`
    select * from public.batch_update_production_log_specs(
      p_sensor_event_ids := $1,
      p_diameter := 1020.0,
      p_actor_user_id := $2
    )
  `, [[evt1], adminId])
  const resetSpec1 = (await db.query('select tonnage, diameter from production_item_specs where sensor_event_id = $1', [evt1])).rows[0]
  assert.equal(resetSpec1.tonnage, null)
  assert.equal(Number(resetSpec1.diameter), 1020)
})

test('migration 054 accepts S-05 output during Idle and single/double process faults, rejecting only during machine downtime', async (t) => {
  const db = await database(t)

  async function ingest(sensorCode, eventType, recordedAt) {
    const signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active'
    return (await db.query(`
      select result.*
      from sensors sensor
      cross join lateral ingest_iot_sensor_event(
        $1,
        sensor.id,
        sensor.machine_id,
        $2,
        $3::jsonb,
        $4
      ) result
      where sensor.sensor_code = $5
    `, [randomUUID(), eventType, JSON.stringify({ signal, metadata: {} }), recordedAt, sensorCode])).rows[0]
  }

  async function acceptedS05Count() {
    const { rows } = await db.query(`
      select count(*)::int as count
      from sensor_events event
      join sensors sensor on sensor.id = event.sensor_id
      where sensor.sensor_code = 'S-05'
        and event.event_type = 'pulse'
        and event.output_accepted is true
    `)
    return rows[0].count
  }

  // 1. Accepted when S-03 is Idle (machine stationary / idle)
  await ingest('S-03', 'idle', '2026-08-21T16:50:00+08:00')
  const idlePulse = await ingest('S-05', 'pulse', '2026-08-21T16:50:05+08:00')
  assert.equal(idlePulse.state_applied, true)
  assert.equal(idlePulse.event_value.metadata.outputAccepted, true)
  assert.equal(idlePulse.event_value.metadata.outputRejectionReason, null)
  assert.equal(await acceptedS05Count(), 1)

  // 2. Accepted when S-01 and S-02 are in Fault (process issue only, no machine downtime)
  await ingest('S-01', 'fault', '2026-08-21T16:51:00+08:00')
  await ingest('S-02', 'fault', '2026-08-21T16:51:05+08:00')
  const processFaultPulse = await ingest('S-05', 'pulse', '2026-08-21T16:51:10+08:00')
  assert.equal(processFaultPulse.state_applied, true)
  assert.equal(processFaultPulse.event_value.metadata.outputAccepted, true)
  assert.equal(await acceptedS05Count(), 2)

  // 3. Rejected when S-04 also faults -> grouped S-01+S-02+S-04 downtime opens
  await ingest('S-04', 'fault', '2026-08-21T16:52:00+08:00')
  const groupedDowntimePulse = await ingest('S-05', 'pulse', '2026-08-21T16:52:05+08:00')
  assert.equal(groupedDowntimePulse.state_applied, false)
  assert.equal(groupedDowntimePulse.event_value.metadata.outputAccepted, false)
  assert.equal(groupedDowntimePulse.event_value.metadata.outputRejectionReason, 'machine_downtime')
  assert.equal(await acceptedS05Count(), 2)

  // 4. Recover grouped downtime via S-01 recovery -> S-05 output accepted again
  await ingest('S-01', 'recovered', '2026-08-21T16:53:00+08:00')
  const recoveredPulse = await ingest('S-05', 'pulse', '2026-08-21T16:53:05+08:00')
  assert.equal(recoveredPulse.state_applied, true)
  assert.equal(recoveredPulse.event_value.metadata.outputAccepted, true)
  assert.equal(await acceptedS05Count(), 3)

  // 5. Rejected during direct S-03 downtime
  await ingest('S-03', 'fault', '2026-08-21T16:54:00+08:00')
  const s03DowntimePulse = await ingest('S-05', 'pulse', '2026-08-21T16:54:05+08:00')
  assert.equal(s03DowntimePulse.state_applied, false)
  assert.equal(s03DowntimePulse.event_value.metadata.outputAccepted, false)
  assert.equal(s03DowntimePulse.event_value.metadata.outputRejectionReason, 'machine_downtime')
  assert.equal(await acceptedS05Count(), 3)

  // 6. S-05 operational status remains Active with no fault_source
  const s05Row = (await db.query("select status, fault_source from sensors where sensor_code = 'S-05'")).rows[0]
  assert.equal(s05Row.status, 'Active')
  assert.equal(s05Row.fault_source, null)
})

test('migration 055 atomically clears confirmed device recovery and rejects stale or duplicate packets', async (t) => {
  const db = await database(t)

  async function ingest(sensorCode, eventType, recordedAt, options = {}) {
    const signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active'
    const eventId = options.eventId || randomUUID()
    const metadata = options.metadata || {}
    return (await db.query(`
      select result.*
      from sensors sensor
      cross join lateral ingest_iot_sensor_event(
        $1,
        sensor.id,
        sensor.machine_id,
        $2,
        $3::jsonb,
        $4
      ) result
      where sensor.sensor_code = $5
    `, [eventId, eventType, JSON.stringify({ signal, metadata }), recordedAt, sensorCode])).rows[0]
  }

  // 1. Enable absence detection and trigger watchdog fault on S-01
  await db.query(`
    update machine_operational_settings
    set sensor_thresholds = jsonb_set(
      sensor_thresholds,
      '{S-01,absenceDetectionEnabled}',
      'true'::jsonb
    )
  `)
  await db.query(`
    update sensors
    set status = 'Fault', fault_source = 'absence_watchdog'
    where sensor_code = 'S-01'
  `)
  await db.query(`
    update sensor_watchdog_state
    set detection_state = 'downtime'
    where sensor_id in (select id from sensors where sensor_code = 'S-01')
  `)

  // 2. An event without recoveryConfirmed routes to watchdog observation (advances recovery observations, keeps Fault status)
  const unconfirmed = await ingest('S-01', 'recovered', '2026-08-21T17:00:00+08:00', { metadata: {} })
  const unconfirmedSensor = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(unconfirmedSensor.status, 'Fault')
  assert.equal(unconfirmedSensor.fault_source, 'absence_watchdog')
  const unconfirmedWatchdog = (await db.query(`
    select detection_state, recovery_observation_count
    from sensor_watchdog_state
    where sensor_id in (select id from sensors where sensor_code = 'S-01')
  `)).rows[0]
  assert.equal(unconfirmedWatchdog.detection_state, 'recovering')
  assert.equal(unconfirmedWatchdog.recovery_observation_count, 1)

  // 3. A confirmed device recovery (recoveryConfirmed: true) routes to grouped sensor event and atomically clears fault
  const confirmedId = randomUUID()
  const confirmed = await ingest('S-01', 'recovered', '2026-08-21T17:00:10+08:00', {
    eventId: confirmedId,
    metadata: { recoveryConfirmed: true },
  })
  assert.equal(confirmed.state_applied, true)
  assert.equal(confirmed.duplicate, false)
  assert.equal(confirmed.stale, false)
  const recoveredSensor = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(recoveredSensor.status, 'Active')
  assert.equal(recoveredSensor.fault_source, null)
  const recoveredWatchdog = (await db.query(`
    select detection_state, open_downtime_id
    from sensor_watchdog_state
    where sensor_id in (select id from sensors where sensor_code = 'S-01')
  `)).rows[0]
  assert.equal(recoveredWatchdog.detection_state, 'healthy')

  // 4. Duplicate confirmed device recovery packet does NOT mutate state
  const dup = await ingest('S-01', 'recovered', '2026-08-21T17:00:10+08:00', {
    eventId: confirmedId,
    metadata: { recoveryConfirmed: true },
  })
  assert.equal(dup.duplicate, true)
  assert.equal(dup.state_applied, false)

  // 5. Stale confirmed device recovery packet does NOT mutate state
  await ingest('S-01', 'pulse', '2026-08-21T17:01:00+08:00')
  await db.query(`
    update sensors
    set status = 'Fault', fault_source = 'absence_watchdog'
    where sensor_code = 'S-01'
  `)
  const stale = await ingest('S-01', 'recovered', '2026-08-21T17:00:30+08:00', {
    metadata: { recoveryConfirmed: true },
  })
  assert.equal(stale.stale, true)
  assert.equal(stale.state_applied, false)
  const stillFaultedSensor = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(stillFaultedSensor.status, 'Fault')
  assert.equal(stillFaultedSensor.fault_source, 'absence_watchdog')

  // 6. Malformed non-boolean recoveryConfirmed (e.g. arbitrary string) does NOT throw 22P02, routes to observation, and does not clear fault
  const malformed = await ingest('S-01', 'recovered', '2026-08-21T17:01:30+08:00', {
    metadata: { recoveryConfirmed: 'invalid_string_not_boolean' },
  })
  assert.equal(malformed.state_applied, true)
  const stillFaultedAfterMalformed = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(stillFaultedAfterMalformed.status, 'Fault')
  assert.equal(stillFaultedAfterMalformed.fault_source, 'absence_watchdog')

  // 7. String 'true' recoveryConfirmed does NOT count as boolean true and does NOT clear fault
  const stringTrue = await ingest('S-01', 'recovered', '2026-08-21T17:01:40+08:00', {
    metadata: { recoveryConfirmed: 'true' },
  })
  assert.equal(stringTrue.state_applied, true)
  const stillFaultedAfterStringTrue = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(stillFaultedAfterStringTrue.status, 'Fault')
  assert.equal(stillFaultedAfterStringTrue.fault_source, 'absence_watchdog')

  // 8. Number 1, boolean false, and null recoveryConfirmed do NOT count as boolean true and do NOT clear fault
  const numberOne = await ingest('S-01', 'recovered', '2026-08-21T17:01:50+08:00', {
    metadata: { recoveryConfirmed: 1 },
  })
  assert.equal(numberOne.state_applied, true)
  const stillFaultedAfterNumberOne = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(stillFaultedAfterNumberOne.status, 'Fault')
  assert.equal(stillFaultedAfterNumberOne.fault_source, 'absence_watchdog')

  const booleanFalse = await ingest('S-01', 'recovered', '2026-08-21T17:02:00+08:00', {
    metadata: { recoveryConfirmed: false },
  })
  assert.equal(booleanFalse.state_applied, true)
  const stillFaultedAfterBooleanFalse = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(stillFaultedAfterBooleanFalse.status, 'Fault')
  assert.equal(stillFaultedAfterBooleanFalse.fault_source, 'absence_watchdog')
})

test('migration 055 reports readiness 55, repairs out-of-order v52-v54 readiness chain, and is safe to reapply', async (t) => {
  // Simulate live database where get_backend_readiness_v52 returned 50 and v53/v54 were skipped
  const db = await database(t, 54)
  await db.exec(`
    create or replace function public.get_backend_readiness_v52()
    returns integer language sql stable as $$ select 50 $$;
  `)
  await assert.rejects(db.query('select public.get_backend_readiness()'), /Required database dependencies are missing/i)

  const migration055 = fs.readFileSync(path.join(databaseRoot, 'migrations', '055_atomic_confirmed_device_recovery.sql'), 'utf8')
  await db.exec(migration055)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 55)

  await db.exec(migration055)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 55)
})

test('migration 056 clears Fault and reconciles Downtime when absence detection is disabled via idle event or watchdog evaluator', async (t) => {
  const db = await database(t)

  const ingest = async (sensorCode, eventType, recordedAt, {
    eventId = randomUUID(),
    signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active',
    metadata = {},
  } = {}) => (await db.query(`
      select result.*
      from public.sensors sensor
      cross join lateral public.ingest_iot_sensor_event(
        $1::uuid,
        sensor.id,
        sensor.machine_id,
        $2::text,
        $3::jsonb,
        $4::timestamptz
      ) result
      where sensor.sensor_code = $5
    `, [eventId, eventType, JSON.stringify({ signal, metadata }), recordedAt, sensorCode])).rows[0]

  const setAbsenceEnabled = async (sensorCode, enabled) => {
    const updated = (await db.query(`
      update machine_operational_settings
      set sensor_thresholds = jsonb_set(
        sensor_thresholds,
        array[$1::text, 'absenceDetectionEnabled'],
        to_jsonb($2::boolean)
      ),
      version = version + 1
      returning machine_id, version, shift_schedule, sensor_thresholds
    `, [sensorCode, enabled])).rows[0]

    await db.query(`
      update machine_operational_settings_history
      set effective_to = clock_timestamp()
      where machine_id = $1 and effective_to is null
    `, [updated.machine_id])

    await db.query(`
      insert into machine_operational_settings_history (
        machine_id, version, effective_from, shift_schedule, sensor_thresholds
      ) values ($1, $2, '2026-08-21T00:00:00+08:00'::timestamptz, $3, $4)
    `, [updated.machine_id, updated.version, updated.shift_schedule, updated.sensor_thresholds])
  }

  // Case 1: S-01, S-02, S-04 are in Fault + Machine is in Downtime. Disabling absence detection on S-01 and ingesting 'idle' clears S-01 Fault and resolves grouped Downtime.
  await setAbsenceEnabled('S-01', true)
  await setAbsenceEnabled('S-02', true)
  await setAbsenceEnabled('S-04', true)
  await ingest('S-02', 'fault', '2026-08-21T09:59:50+08:00')
  await ingest('S-04', 'fault', '2026-08-21T09:59:55+08:00')
  const fault1 = await ingest('S-01', 'fault', '2026-08-21T10:00:00+08:00')
  assert.equal(fault1.new_machine_status, 'Downtime')
  assert.equal(fault1.downtime_action, 'created')

  // When absence detection is still enabled, 'idle' keeps Fault and Downtime
  const idleWhileEnabled = await ingest('S-01', 'idle', '2026-08-21T10:00:05+08:00')
  assert.equal(idleWhileEnabled.new_machine_status, 'Downtime')
  const s01StillFault = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.equal(s01StillFault.status, 'Fault')

  // Acknowledge the active S-01 process alert so we can verify it auto-resolves on disable + idle
  await db.query(`
    update alerts
    set status = 'Acknowledged'
    where source_type = 'sensor'
      and sensor_id = (select id from sensors where sensor_code = 'S-01')
      and status = 'Active'
  `)

  // Disable S-01 absence detection and send 'idle' (as ESP32 firmware does upon config sync)
  await setAbsenceEnabled('S-01', false)
  const idleAfterDisable = await ingest('S-01', 'idle', '2026-08-21T10:00:10+08:00')
  assert.equal(idleAfterDisable.state_applied, true)
  assert.equal(idleAfterDisable.new_machine_status, 'Running')
  assert.equal(idleAfterDisable.downtime_action, 'resolved')

  const s01Cleared = (await db.query("select status, fault_source from sensors where sensor_code = 'S-01'")).rows[0]
  assert.deepEqual(s01Cleared, { status: 'Inactive', fault_source: null })

  const s01Watchdog = (await db.query(`
    select detection_state, absence_baseline_at, recovery_started_at, recovery_observation_count, open_downtime_id
    from sensor_watchdog_state
    where sensor_id = (select id from sensors where sensor_code = 'S-01')
  `)).rows[0]
  assert.deepEqual(s01Watchdog, {
    detection_state: 'disabled',
    absence_baseline_at: null,
    recovery_started_at: null,
    recovery_observation_count: 0,
    open_downtime_id: null,
  })

  const s01Alert = (await db.query(`
    select status
    from alerts
    where source_type = 'sensor'
      and sensor_id = (select id from sensors where sensor_code = 'S-01')
    order by created_at desc limit 1
  `)).rows[0]
  assert.equal(s01Alert.status, 'Resolved')

  // Case 2: S-03 is in Fault + Machine is in Downtime. Disabling absence detection and running evaluate_sensor_watchdog('enforce') clears Fault and Downtime even if device is offline.
  await setAbsenceEnabled('S-03', true)
  const fault3 = await ingest('S-03', 'fault', '2026-08-21T10:01:00+08:00')
  assert.equal(fault3.new_machine_status, 'Downtime')
  assert.equal(fault3.downtime_action, 'created')

  await setAbsenceEnabled('S-03', false)
  const s03Id = (await db.query("select id from sensors where sensor_code = 'S-03'")).rows[0].id
  const evalResult = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-08-21T10:01:15+08:00'::timestamptz, 'enforce', 15)",
    [s03Id],
  )).rows[0]
  assert.equal(evalResult.detection_state, 'disabled')

  const s03Cleared = (await db.query("select status, fault_source from sensors where sensor_code = 'S-03'")).rows[0]
  assert.deepEqual(s03Cleared, { status: 'Inactive', fault_source: null })

  const machineAfterWatchdog = (await db.query("select status from machines where machine_code = 'M-01'")).rows[0]
  assert.equal(machineAfterWatchdog.status, 'Idle')

  const openDowntimes = (await db.query("select count(*)::int as count from downtime_events where status = 'Open'")).rows[0]
  assert.equal(openDowntimes.count, 0)
})

test('migration 057 enforces atomic user status updates and account archiving with audit rollback and revokes direct users mutations', async (t) => {
  const db = await database(t)
  const adminId = (await db.query("select id from users where username = 'release-admin'")).rows[0].id
  const passwordHash = '$2b$10$' + 'a'.repeat(53)
  const targetId = (await db.query(`
    insert into users (name, username, email, password_hash, role_id, onboarding_state)
    select 'Status Target', 'status-target', 'status-target@example.test', $1, id, 'Ready'
    from roles
    where name = 'Production Supervisor'
    returning id
  `, [passwordHash])).rows[0].id

  await db.exec('set role service_role;')

  // 1. Direct INSERT, UPDATE, and DELETE on public.users are blocked for service_role
  await assert.rejects(
    db.query("update public.users set status = 'Inactive' where id = $1", [targetId]),
    /permission denied/i,
  )
  await assert.rejects(
    db.query('delete from public.users where id = $1', [targetId]),
    /permission denied/i,
  )

  // 2. Self-deactivation, self-archive, and Admin target mutations are rejected
  await assert.rejects(
    db.query("select public.update_user_account_status($1, $1, 'Inactive')", [adminId]),
    /cannot deactivate their own account/i,
  )
  await assert.rejects(
    db.query('select public.archive_user_account($1, $1)', [adminId]),
    /cannot archive their own account/i,
  )

  // 3. Non-admin actor is rejected
  await assert.rejects(
    db.query("select public.update_user_account_status($1, $2, 'Inactive')", [targetId, adminId]),
    /Admin access required/i,
  )
  await assert.rejects(
    db.query('select public.archive_user_account($1, $2)', [targetId, adminId]),
    /Admin access required/i,
  )

  // 4. Atomic rollback when audit_logs write fails during status update or archive
  await db.exec('reset role;')
  await db.exec(`
    create function fail_user_mutation_audit() returns trigger language plpgsql as $$
    begin
      if new.action in ('USER_STATUS_UPDATED', 'USER_ARCHIVED') then
        raise exception 'audit unavailable';
      end if;
      return new;
    end $$;
    create trigger fail_user_mutation_audit
    before insert on public.audit_logs
    for each row execute function fail_user_mutation_audit();
  `)
  await db.exec('set role service_role;')

  await assert.rejects(
    db.query("select public.update_user_account_status($1, $2, 'Inactive')", [adminId, targetId]),
    /audit unavailable/i,
  )
  const afterFailedStatus = (await db.query('select status, deleted_at from public.users where id = $1', [targetId])).rows[0]
  assert.deepEqual(afterFailedStatus, { status: 'Active', deleted_at: null })

  await assert.rejects(
    db.query('select public.archive_user_account($1, $2)', [adminId, targetId]),
    /audit unavailable/i,
  )
  const afterFailedArchive = (await db.query('select status, deleted_at from public.users where id = $1', [targetId])).rows[0]
  assert.deepEqual(afterFailedArchive, { status: 'Active', deleted_at: null })

  await db.exec('reset role;')
  await db.exec('drop trigger fail_user_mutation_audit on public.audit_logs; drop function fail_user_mutation_audit();')
  await db.exec('set role service_role;')

  // 5. Status update succeeds, revokes active sessions on deactivation, writes audit log, and is idempotent on retry
  await db.query("select public.issue_refresh_token($1, $2, now() + interval '1 hour', $3)", [targetId, 'a'.repeat(64), passwordHash])
  const deactivated = (await db.query(
    "select public.update_user_account_status($1, $2, 'Inactive') as result",
    [adminId, targetId],
  )).rows[0].result
  assert.equal(deactivated.id, targetId)
  assert.equal(deactivated.status, 'Inactive')
  assert.equal(deactivated.role, 'Production Supervisor')
  assert.ok((await db.query('select revoked_at from public.auth_sessions where user_id = $1', [targetId])).rows[0].revoked_at)
  assert.ok((await db.query('select revoked_at from public.refresh_tokens where user_id = $1', [targetId])).rows[0].revoked_at)

  // Retry with identical status does not duplicate audit row
  await db.query("select public.update_user_account_status($1, $2, 'Inactive')", [adminId, targetId])
  const statusAudits = (await db.query(`
    select user_id, metadata
    from public.audit_logs
    where entity_id = $1 and action = 'USER_STATUS_UPDATED'
  `, [targetId])).rows
  assert.equal(statusAudits.length, 1)
  assert.equal(statusAudits[0].user_id, adminId)
  assert.deepEqual(statusAudits[0].metadata, {
    targetUsername: 'status-target',
    targetRole: 'Production Supervisor',
    newStatus: 'Inactive',
  })

  // Reactivate before archiving so previousStatus is 'Active'
  const reactivated = (await db.query(
    "select public.update_user_account_status($1, $2, 'Active') as result",
    [adminId, targetId],
  )).rows[0].result
  assert.equal(reactivated.status, 'Active')

  // 6. Archive succeeds, sets deleted_at + status Inactive, writes USER_ARCHIVED audit log, and rejects second archive with P0002
  const archived = (await db.query(
    'select public.archive_user_account($1, $2) as result',
    [adminId, targetId],
  )).rows[0].result
  assert.equal(archived.id, targetId)
  assert.equal(archived.status, 'Inactive')
  assert.ok(archived.deletedAt)

  const archiveAudits = (await db.query(`
    select user_id, metadata
    from public.audit_logs
    where entity_id = $1 and action = 'USER_ARCHIVED'
  `, [targetId])).rows
  assert.equal(archiveAudits.length, 1)
  assert.equal(archiveAudits[0].user_id, adminId)
  assert.equal(archiveAudits[0].metadata.targetUsername, 'status-target')
  assert.equal(archiveAudits[0].metadata.targetRole, 'Production Supervisor')
  assert.equal(archiveAudits[0].metadata.previousStatus, 'Active')
  assert.equal(archiveAudits[0].metadata.newStatus, 'Inactive')
  assert.ok(archiveAudits[0].metadata.archivedAt)

  await assert.rejects(
    db.query('select public.archive_user_account($1, $2)', [adminId, targetId]),
    /User not found/i,
  )

  await db.exec('reset role;')
})



