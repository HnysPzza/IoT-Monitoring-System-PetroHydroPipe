const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { randomUUID } = require('node:crypto')
const databaseRoot = path.resolve(__dirname, '../../database')
const releaseSchemaVersion = 62

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

test('migration 058 creates query optimization indexes and preserves get_analytics_first_recorded_at bounds', async (t) => {
  const db = await database(t)

  const indexes = (await db.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_audit_logs_created_at',
        'idx_sensor_events_analytics_pulse',
        'idx_sensor_events_s05_accepted_ordered'
      )
    order by indexname
  `)).rows.map((row) => row.indexname)
  assert.deepEqual(indexes, [
    'idx_audit_logs_created_at',
    'idx_sensor_events_analytics_pulse',
    'idx_sensor_events_s05_accepted_ordered',
  ])

  const machineId = (await db.query("select id from public.machines where machine_code = 'M-01'")).rows[0].id
  const sensorsByCode = Object.fromEntries(
    (await db.query('select sensor_code, id from public.sensors where machine_id = $1', [machineId]))
      .rows.map((row) => [row.sensor_code, row.id]),
  )

  await db.exec('set role service_role;')
  const emptyFirst = (await db.query('select public.get_analytics_first_recorded_at($1) as first_at', [machineId])).rows[0].first_at
  assert.equal(emptyFirst, null)

  await db.exec('reset role;')
  // Rejected S-05 pulse and S-03 pulse should be ignored by get_analytics_first_recorded_at
  await db.query(`
    insert into public.sensor_events (sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at, stale, output_accepted)
    values
      ($1, $3, $4, 'pulse', '{"signal":"active"}'::jsonb, '2026-06-01T01:00:00Z'::timestamptz, false, false),
      ($2, $3, $5, 'pulse', '{"signal":"active"}'::jsonb, '2026-06-01T02:00:00Z'::timestamptz, false, null),
      ($1, $3, $6, 'pulse', '{"signal":"active"}'::jsonb, '2026-06-01T04:00:00Z'::timestamptz, false, true)
  `, [sensorsByCode['S-05'], sensorsByCode['S-03'], machineId, randomUUID(), randomUUID(), randomUUID()])

  await db.exec('set role service_role;')
  const pulseFirst = (await db.query('select public.get_analytics_first_recorded_at($1) as first_at', [machineId])).rows[0].first_at
  assert.equal(new Date(pulseFirst).toISOString(), '2026-06-01T04:00:00.000Z')

  await db.exec('reset role;')
  await db.query(`
    insert into public.downtime_events (machine_id, sensor_id, started_at, status, cause)
    values ($1, $2, '2026-06-01T03:00:00Z'::timestamptz, 'Open', 'Test cause')
  `, [machineId, sensorsByCode['S-01']])

  await db.exec('set role service_role;')
  const downtimeFirst = (await db.query('select public.get_analytics_first_recorded_at($1) as first_at', [machineId])).rows[0].first_at
  assert.equal(new Date(downtimeFirst).toISOString(), '2026-06-01T03:00:00.000Z')
  await db.exec('reset role;')
})

test('migration 060 rejects S-05 output pulses when S-03 is offline without downtime and accepts when S-03 is online', async (t) => {
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

  // 1. Fresh state: S-03 has never connected (connectivity_state = 'unknown', no heartbeat/event) -> S-05 pulse rejected as machine_offline
  const unconnectedPulse = await ingest('S-05', 'pulse', '2026-08-21T16:49:00+08:00')
  assert.equal(unconnectedPulse.state_applied, false)
  assert.equal(unconnectedPulse.event_value.metadata.outputAccepted, false)
  assert.equal(unconnectedPulse.event_value.metadata.outputRejectionReason, 'machine_offline')
  assert.equal(await acceptedS05Count(), 0)
  const s05AfterUnconnected = (await db.query("select last_applied_recorded_at from sensors where sensor_code = 'S-05'")).rows[0]
  assert.equal(s05AfterUnconnected.last_applied_recorded_at, null)

  // 2. S-03 sends a heartbeat -> S-03 is online (even while machine is Idle) -> S-05 pulse accepted
  const bootId = randomUUID()
  await db.query(`
    select result.*
    from sensors sensor
    cross join lateral ingest_iot_heartbeat($1, sensor.id, sensor.machine_id, 1, $2, 1, '2026-08-21T16:50:00+08:00', false) result
    where sensor.sensor_code = 'S-03'
  `, [randomUUID(), bootId])
  const onlineHeartbeatPulse = await ingest('S-05', 'pulse', '2026-08-21T16:50:05+08:00')
  assert.equal(onlineHeartbeatPulse.state_applied, true)
  assert.equal(onlineHeartbeatPulse.event_value.metadata.outputAccepted, true)
  assert.equal(onlineHeartbeatPulse.event_value.metadata.outputRejectionReason, null)
  assert.equal(await acceptedS05Count(), 1)

  // 3. S-03 heartbeat becomes stale (> 30s) and watchdog marks S-03 offline (no downtime, detection suspended) -> S-05 pulse rejected as machine_offline
  await db.query(`
    update sensor_watchdog_state
    set last_heartbeat_received_at = clock_timestamp() - interval '60 seconds'
    where sensor_id = (select id from sensors where sensor_code = 'S-03')
  `)
  const s03Id = (await db.query("select id from sensors where sensor_code = 'S-03'")).rows[0].id
  const watchdogEval = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, clock_timestamp(), 'enforce', 30)",
    [s03Id],
  )).rows[0]
  assert.equal(watchdogEval.connectivity_state, 'offline')
  assert.equal((await db.query("select count(*)::int as count from downtime_events where status = 'Open'")).rows[0].count, 0)

  const offlineWatchdogPulse = await ingest('S-05', 'pulse', '2026-08-21T16:51:10+08:00')
  assert.equal(offlineWatchdogPulse.state_applied, false)
  assert.equal(offlineWatchdogPulse.event_value.metadata.outputAccepted, false)
  assert.equal(offlineWatchdogPulse.event_value.metadata.outputRejectionReason, 'machine_offline')
  assert.equal(await acceptedS05Count(), 1)

  // 4. Even when watchdog is disabled (connectivity_state still 'online'), stale S-03 heartbeat + stale event (> 30s) -> rejected as machine_offline
  await db.query(`
    update sensor_watchdog_state
    set connectivity_state = 'online',
      last_heartbeat_received_at = clock_timestamp() - interval '60 seconds',
      last_activity_received_at = clock_timestamp() - interval '60 seconds'
    where sensor_id = $1
  `, [s03Id])
  const staleDisabledWatchdogPulse = await ingest('S-05', 'pulse', '2026-08-21T16:52:00+08:00')
  assert.equal(staleDisabledWatchdogPulse.state_applied, false)
  assert.equal(staleDisabledWatchdogPulse.event_value.metadata.outputAccepted, false)
  assert.equal(staleDisabledWatchdogPulse.event_value.metadata.outputRejectionReason, 'machine_offline')
  assert.equal(await acceptedS05Count(), 1)

  // 5. When S-03 is in Downtime AND goes offline, machine_downtime takes precedence over machine_offline
  await ingest('S-03', 'fault', '2026-08-21T16:53:00+08:00')
  await db.query(`
    update sensor_watchdog_state
    set connectivity_state = 'offline',
      last_evaluated_at = clock_timestamp()
    where sensor_id = $1
  `, [s03Id])
  const downtimeAndOfflinePulse = await ingest('S-05', 'pulse', '2026-08-21T16:53:05+08:00')
  assert.equal(downtimeAndOfflinePulse.state_applied, false)
  assert.equal(downtimeAndOfflinePulse.event_value.metadata.outputAccepted, false)
  assert.equal(downtimeAndOfflinePulse.event_value.metadata.outputRejectionReason, 'machine_downtime')
  assert.equal(await acceptedS05Count(), 1)

  // 6. S-03 recovers from fault -> S-03 is online again -> S-05 pulse accepted
  await ingest('S-03', 'recovered', '2026-08-21T16:54:00+08:00')
  const recoveredPulse = await ingest('S-05', 'pulse', '2026-08-21T16:54:05+08:00')
  assert.equal(recoveredPulse.state_applied, true)
  assert.equal(recoveredPulse.event_value.metadata.outputAccepted, true)
  assert.equal(recoveredPulse.event_value.metadata.outputRejectionReason, null)
  assert.equal(await acceptedS05Count(), 2)

  // 7. Reapplying migration 060 is idempotent and keeps readiness at 60
  const migration060 = fs.readFileSync(
    path.join(databaseRoot, 'migrations', '060_reject_s05_output_when_s03_offline.sql'),
    'utf8',
  )
  await db.exec(migration060)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 60)
})

test('migration 060 prevents after-hours ESP32 absence fault downtime and clears stuck after-hours fault via watchdog or device activity', async (t) => {
  const db = await database(t)

  async function ingest(sensorCode, eventType, recordedAt, metadata = {}) {
    const signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active'
    return (await db.query(`
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
    `, [randomUUID(), eventType, JSON.stringify({ signal, metadata }), recordedAt, sensorCode])).rows[0]
  }

  await db.query(`
    update public.machine_operational_settings
    set sensor_thresholds = jsonb_set(
      sensor_thresholds,
      '{S-03}',
      '{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60,"rotationStallMs":3000}'::jsonb
    )
  `)

  // 1. After working hours (21:11:40 Manila, past workEnd): ESP32 on-device absence timeout fault (detectionState='FAULT') stays Inactive/Idle and does NOT open downtime
  const afterHoursAbsenceFault = await ingest('S-03', 'fault', '2026-11-18T13:11:40+00:00', {
    spindleState: 'CONSTANT_NO_METAL_DOWNTIME',
    detectionState: 'FAULT',
    rotationStallMs: 3000,
  })
  assert.equal(afterHoursAbsenceFault.state_applied, true)
  assert.equal(afterHoursAbsenceFault.new_machine_status, 'Idle')
  assert.equal(afterHoursAbsenceFault.downtime_action, null)
  const s03AfterHours = (await db.query("select status, fault_source from public.sensors where sensor_code = 'S-03'")).rows[0]
  assert.deepEqual(s03AfterHours, { status: 'Inactive', fault_source: null })
  assert.equal((await db.query("select count(*)::int as count from public.downtime_events where status = 'Open'")).rows[0].count, 0)

  // 2. If S-03 had an after-hours fault/downtime opened while watchdog was disabled, switching watchdog to enforce after hours (detection_state='suspended') auto-clears Fault and resolves downtime
  const s03Row = (await db.query("select id, machine_id from public.sensors where sensor_code = 'S-03'")).rows[0]
  await db.query("update public.sensors set status = 'Fault', fault_source = 'explicit' where id = $1", [s03Row.id])
  await db.query("update public.machines set status = 'Downtime' where id = $1", [s03Row.machine_id])
  await db.query(`
    insert into public.downtime_events (machine_id, sensor_id, started_at, cause, status, detection_source)
    values ($1, $2, '2026-11-18T13:11:40+00:00'::timestamptz, 'Pending Cause Review', 'Open', 'sensor_event')
  `, [s03Row.machine_id, s03Row.id])

  const evalAfterHours = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-11-18T13:14:55+00:00'::timestamptz, 'enforce', 30)",
    [s03Row.id],
  )).rows[0]
  assert.equal(evalAfterHours.detection_state, 'suspended')
  const s03ReleasedByWatchdog = (await db.query("select status, fault_source from public.sensors where id = $1", [s03Row.id])).rows[0]
  assert.deepEqual(s03ReleasedByWatchdog, { status: 'Inactive', fault_source: null })
  assert.equal((await db.query("select status from public.machines where id = $1", [s03Row.machine_id])).rows[0].status, 'Idle')
  assert.equal((await db.query("select count(*)::int as count from public.downtime_events where status = 'Open'")).rows[0].count, 0)

  // 3. If S-03 faulted via absence_watchdog during work hours (16:58 Manila) and user pulses S-03 after work hours (21:16 Manila), pulse with detectionState='RUNNING' immediately clears Fault and resolves downtime
  await db.query("update public.sensors set status = 'Fault', fault_source = 'absence_watchdog' where id = $1", [s03Row.id])
  await db.query("update public.sensor_watchdog_state set detection_state = 'downtime' where sensor_id = $1", [s03Row.id])
  await db.query("update public.machines set status = 'Downtime' where id = $1", [s03Row.machine_id])
  await db.query(`
    insert into public.downtime_events (machine_id, sensor_id, started_at, cause, status, detection_source)
    values ($1, $2, '2026-11-18T08:58:00+00:00'::timestamptz, 'Pending Cause Review', 'Open', 'absence_watchdog')
  `, [s03Row.machine_id, s03Row.id])

  const afterHoursPulse = await ingest('S-03', 'pulse', '2026-11-18T13:16:00+00:00', {
    spindleState: 'ROTATING_ON_OFF',
    detectionState: 'RUNNING',
    rotationStallMs: 3000,
  })
  assert.equal(afterHoursPulse.state_applied, true)
  assert.equal(afterHoursPulse.new_machine_status, 'Running')
  assert.equal(afterHoursPulse.downtime_action, 'resolved')
  const s03RecoveredAfterHours = (await db.query("select status, fault_source from public.sensors where id = $1", [s03Row.id])).rows[0]
  assert.deepEqual(s03RecoveredAfterHours, { status: 'Active', fault_source: null })
  assert.equal((await db.query("select count(*)::int as count from public.downtime_events where status = 'Open'")).rows[0].count, 0)

  // 4. Genuine explicit hardware fault (without detectionState='FAULT') outside working hours stays Fault/Downtime across watchdog enforce ticks
  const explicitHardwareFault = await ingest('S-03', 'fault', '2026-11-18T13:17:00+00:00', {
    reason: 'wiring_short',
  })
  assert.equal(explicitHardwareFault.new_machine_status, 'Downtime')
  assert.equal(explicitHardwareFault.downtime_action, 'created')
  const evalDuringExplicitAfterHours = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-11-18T13:17:05+00:00'::timestamptz, 'enforce', 30)",
    [s03Row.id],
  )).rows[0]
  assert.equal(evalDuringExplicitAfterHours.detection_state, 'suspended')
  const s03StillExplicitFault = (await db.query("select status, fault_source from public.sensors where id = $1", [s03Row.id])).rows[0]
  assert.deepEqual(s03StillExplicitFault, { status: 'Fault', fault_source: 'explicit' })
  assert.equal((await db.query("select count(*)::int as count from public.downtime_events where status = 'Open'")).rows[0].count, 1)
  await ingest('S-03', 'recovered', '2026-11-18T13:17:10+00:00', { reason: 'wiring_restored' })
  assert.equal((await db.query("select count(*)::int as count from public.downtime_events where status = 'Open'")).rows[0].count, 0)

  // 5. Working-hour S-01 absence_watchdog fault survives lunch break (suspended) evaluation instead of disappearing at break start
  await db.query(`
    update public.machine_operational_settings
    set sensor_thresholds = jsonb_set(
      sensor_thresholds,
      '{S-01}',
      '{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60}'::jsonb
    )
  `)
  const s01Row = (await db.query("select id from public.sensors where sensor_code = 'S-01'")).rows[0]
  await db.query("update public.sensors set status = 'Fault', fault_source = 'absence_watchdog' where id = $1", [s01Row.id])
  await db.query("update public.sensor_watchdog_state set detection_state = 'downtime' where sensor_id = $1", [s01Row.id])
  const evalDuringLunch = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-11-18T04:15:00+00:00'::timestamptz, 'enforce', 30)",
    [s01Row.id],
  )).rows[0]
  assert.equal(evalDuringLunch.detection_state, 'downtime')
  assert.deepEqual(
    (await db.query("select status, fault_source from public.sensors where id = $1", [s01Row.id])).rows[0],
    { status: 'Fault', fault_source: 'absence_watchdog' },
  )
})

test('migration 061 rejects S-05 output outside schedule, during breaks, on rest days, and on non-working calendar days while accepting early post-break starts', async (t) => {
  const db = await database(t)
  const machineId = (await db.query("select id from public.machines where machine_code = 'M-01'")).rows[0].id
  const adminId = (await db.query("select id from users where username = 'release-admin'")).rows[0].id
  const s03Id = (await db.query("select id from sensors where sensor_code = 'S-03'")).rows[0].id
  const bootId = randomUUID()
  let heartbeatSequence = 1

  async function refreshS03Heartbeat(recordedAt) {
    await db.query(`
      select result.*
      from sensors sensor
      cross join lateral ingest_iot_heartbeat($1, sensor.id, sensor.machine_id, 1, $2, $3, $4, false) result
      where sensor.sensor_code = 'S-03'
    `, [randomUUID(), bootId, heartbeatSequence++, recordedAt])
  }

  async function ingestS05(recordedAt) {
    return (await db.query(`
      select result.*
      from sensors sensor
      cross join lateral ingest_iot_sensor_event(
        $1::uuid,
        sensor.id,
        sensor.machine_id,
        'pulse',
        '{"signal":"active","metadata":{}}'::jsonb,
        $2::timestamptz
      ) result
      where sensor.sensor_code = 'S-05'
    `, [randomUUID(), recordedAt])).rows[0]
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

  // Anchor migration 059 restDays history boundary to 2026-08-16 so August 2026 schedule scenarios use version 2 while keeping S-03 online
  await db.query(`
    update public.machine_operational_settings_history
    set effective_to = '2026-08-16T00:00:00+08:00'::timestamptz
    where machine_id = $1 and version = 1
  `, [machineId])
  await db.query(`
    update public.machine_operational_settings_history
    set effective_from = '2026-08-16T00:00:00+08:00'::timestamptz
    where machine_id = $1 and version = 2
  `, [machineId])
  await refreshS03Heartbeat('2026-08-16T08:00:00+08:00')

  // 1. Weekly rest day (default restDays=['sunday']): Sunday 2026-08-16 during 08:00-17:00 -> outside_schedule
  const sundayRestDay = await ingestS05('2026-08-16T10:30:00+08:00')
  assert.equal(sundayRestDay.state_applied, false)
  assert.equal(sundayRestDay.event_value.metadata.outputAccepted, false)
  assert.equal(sundayRestDay.event_value.metadata.outputRejectionReason, 'outside_schedule')
  assert.equal((await db.query("select last_applied_recorded_at from sensors where sensor_code = 'S-05'")).rows[0].last_applied_recorded_at, null)

  // 2. Before workStart (07:59:59+08:00) on working Friday 2026-08-21 -> outside_schedule; exact workStart (08:00:00) -> accepted
  const beforeStart = await ingestS05('2026-08-21T07:59:59+08:00')
  assert.equal(beforeStart.state_applied, false)
  assert.equal(beforeStart.event_value.metadata.outputRejectionReason, 'outside_schedule')

  const atStart = await ingestS05('2026-08-21T08:00:00+08:00')
  assert.equal(atStart.state_applied, true)
  assert.equal(atStart.event_value.metadata.outputAccepted, true)
  assert.equal(atStart.event_value.metadata.outputRejectionReason, null)
  assert.equal(await acceptedS05Count(), 1)

  // 3. During Lunch Break (12:00:00 and 12:30:00+08:00) -> outside_schedule
  const atBreakStart = await ingestS05('2026-08-21T12:00:00+08:00')
  assert.equal(atBreakStart.state_applied, false)
  assert.equal(atBreakStart.event_value.metadata.outputRejectionReason, 'outside_schedule')

  const midBreak = await ingestS05('2026-08-21T12:30:00+08:00')
  assert.equal(midBreak.state_applied, false)
  assert.equal(midBreak.event_value.metadata.outputRejectionReason, 'outside_schedule')

  // 4. Early machine start right after break during rampUpGraceMinutes (13:00..13:10) -> accepted
  const earlyAfterBreak = await ingestS05('2026-08-21T13:00:00+08:00')
  assert.equal(earlyAfterBreak.state_applied, true)
  assert.equal(earlyAfterBreak.event_value.metadata.outputAccepted, true)

  const midGrace = await ingestS05('2026-08-21T13:05:00+08:00')
  assert.equal(midGrace.state_applied, true)
  assert.equal(midGrace.event_value.metadata.outputAccepted, true)
  assert.equal(await acceptedS05Count(), 3)

  // 5. Sub-second right before workEnd (16:59:59.500) -> accepted; exact workEnd (17:00:00) & after workEnd -> outside_schedule
  const rightBeforeEnd = await ingestS05('2026-08-21T16:59:59.500+08:00')
  assert.equal(rightBeforeEnd.state_applied, true)
  assert.equal(rightBeforeEnd.event_value.metadata.outputAccepted, true)

  const atWorkEnd = await ingestS05('2026-08-21T17:00:00+08:00')
  assert.equal(atWorkEnd.state_applied, false)
  assert.equal(atWorkEnd.event_value.metadata.outputRejectionReason, 'outside_schedule')

  const afterWorkEnd = await ingestS05('2026-08-21T18:30:00+08:00')
  assert.equal(afterWorkEnd.state_applied, false)
  assert.equal(afterWorkEnd.event_value.metadata.outputRejectionReason, 'outside_schedule')
  assert.equal(await acceptedS05Count(), 4)

  // 6. Calendar entries for 2026-08-23..2026-08-26:
  //    - 2026-08-23 (Sun): working holiday override (is_working = true) -> accepted in shift, rejected after workEnd
  //    - 2026-08-24 (Mon): day_off (is_working = false) -> outside_schedule
  //    - 2026-08-25 (Tue): machine_not_scheduled (is_working = false) -> outside_schedule
  //    - 2026-08-26 (Wed): non-working holiday (is_working = false) -> outside_schedule
  await db.query(`
    insert into public.production_calendar_days (
      machine_id, calendar_date, name, day_type, is_working, reason, source, version, updated_by
    ) values
      ($1, '2026-08-23', 'Special Working Sunday', 'holiday', true, null, 'manual', 1, $2),
      ($1, '2026-08-24', 'Plant Day Off', 'day_off', false, 'Scheduled shutdown', 'manual', 1, $2),
      ($1, '2026-08-25', 'No Mill Run', 'machine_not_scheduled', false, 'No orders', 'manual', 1, $2),
      ($1, '2026-08-26', 'Special Non-Working Holiday', 'holiday', false, null, 'manual', 1, $2)
  `, [machineId, adminId])

  const workingHolidayOnSunday = await ingestS05('2026-08-23T09:00:00+08:00')
  assert.equal(workingHolidayOnSunday.state_applied, true)
  assert.equal(workingHolidayOnSunday.event_value.metadata.outputAccepted, true)

  const workingHolidayAfterWorkEnd = await ingestS05('2026-08-23T17:00:00+08:00')
  assert.equal(workingHolidayAfterWorkEnd.state_applied, false)
  assert.equal(workingHolidayAfterWorkEnd.event_value.metadata.outputRejectionReason, 'outside_schedule')

  const manualDayOff = await ingestS05('2026-08-24T09:00:00+08:00')
  assert.equal(manualDayOff.state_applied, false)
  assert.equal(manualDayOff.event_value.metadata.outputRejectionReason, 'outside_schedule')

  const machineNotScheduled = await ingestS05('2026-08-25T09:00:00+08:00')
  assert.equal(machineNotScheduled.state_applied, false)
  assert.equal(machineNotScheduled.event_value.metadata.outputRejectionReason, 'outside_schedule')

  const nonWorkingHoliday = await ingestS05('2026-08-26T09:00:00+08:00')
  assert.equal(nonWorkingHoliday.state_applied, false)
  assert.equal(nonWorkingHoliday.event_value.metadata.outputRejectionReason, 'outside_schedule')
  assert.equal(await acceptedS05Count(), 5)

  // 7. Future production calendar RPCs (day + range) drive is_machine_output_schedule_eligible
  await db.query(`
    select public.set_production_calendar_day($1, '2027-08-22', 'holiday', 'Working Sunday Override', true, null, null, true, $2)
  `, [machineId, adminId])
  await db.query(`
    select * from public.set_production_calendar_range($1, '2027-08-24', '2027-08-25', 'machine_not_scheduled', 'Future Shutdown', 'Planned overhaul', true, null, $2)
  `, [machineId, adminId])
  assert.equal(
    (await db.query("select public.is_machine_output_schedule_eligible($1, '2027-08-22T09:00:00+08:00'::timestamptz) as eligible", [machineId])).rows[0].eligible,
    true,
  )
  assert.equal(
    (await db.query("select public.is_machine_output_schedule_eligible($1, '2027-08-24T09:00:00+08:00'::timestamptz) as eligible", [machineId])).rows[0].eligible,
    false,
  )

  // 8. Precedence: outside_schedule rejects even if S-03 is offline; machine_downtime still wins over outside_schedule
  await db.query(`
    update sensor_watchdog_state
    set connectivity_state = 'offline',
      last_heartbeat_received_at = clock_timestamp() - interval '60 seconds',
      last_activity_received_at = clock_timestamp() - interval '60 seconds',
      last_evaluated_at = clock_timestamp()
    where sensor_id = $1
  `, [s03Id])
  const offAndOffline = await ingestS05('2026-08-26T09:05:00+08:00')
  assert.equal(offAndOffline.state_applied, false)
  assert.equal(offAndOffline.event_value.metadata.outputRejectionReason, 'outside_schedule')

  await db.query("update machines set status = 'Downtime' where id = $1", [machineId])
  const offAndDowntime = await ingestS05('2026-08-26T09:10:00+08:00')
  assert.equal(offAndDowntime.state_applied, false)
  assert.equal(offAndDowntime.event_value.metadata.outputRejectionReason, 'machine_downtime')

  // 9. Analytics only counts accepted pulses (excludes all rejected outside_schedule pulses)
  const analyticsRows = (await db.query(`
    select coalesce(sum(event_count), 0)::bigint as count
    from aggregate_analytics_sensor_events($1, '2026-08-16T00:00:00+08:00', '2026-08-27T00:00:00+08:00', 86400)
    where sensor_code = 'S-05'
  `, [machineId])).rows[0]
  assert.equal(Number(analyticsRows.count), 5)

  // 10. Live update_machine_operational_settings (restDays + work window) takes effect immediately on subsequent pulses
  await db.query("update machines set status = 'Running' where id = $1", [machineId])
  await refreshS03Heartbeat('2026-08-26T09:15:00+08:00')
  await refreshS03Heartbeat('2026-08-26T09:15:10+08:00')
  const settingsRow = (await db.query(
    'select sensor_thresholds, shift_schedule, version from public.machine_operational_settings where machine_id = $1',
    [machineId],
  )).rows[0]
  const manilaClock = (await db.query(`
    select
      extract(hour from (clock_timestamp() at time zone 'Asia/Manila'))::int as hour,
      extract(minute from (clock_timestamp() at time zone 'Asia/Manila'))::int as minute,
      case extract(isodow from (clock_timestamp() at time zone 'Asia/Manila')::date)::integer
        when 1 then 'monday' when 2 then 'tuesday' when 3 then 'wednesday'
        when 4 then 'thursday' when 5 then 'friday' when 6 then 'saturday' when 7 then 'sunday'
      end as weekday
  `)).rows[0]

  const updatedRest = (await db.query(`
    select * from public.update_machine_operational_settings($1, $2, $3::jsonb, $4::jsonb, $5)
  `, [
    machineId,
    settingsRow.version,
    JSON.stringify(settingsRow.sensor_thresholds),
    JSON.stringify({ ...settingsRow.shift_schedule, restDays: [manilaClock.weekday] }),
    adminId,
  ])).rows[0]

  const nowTs = (await db.query('select clock_timestamp() as ts')).rows[0].ts
  const rejectedOnRestDay = await ingestS05(nowTs)
  assert.equal(rejectedOnRestDay.state_applied, false)
  assert.equal(rejectedOnRestDay.event_value.metadata.outputRejectionReason, 'outside_schedule')

  await db.query(`
    select * from public.update_machine_operational_settings($1, $2, $3::jsonb, $4::jsonb, $5)
  `, [
    machineId,
    updatedRest.version,
    JSON.stringify(updatedRest.sensor_thresholds),
    JSON.stringify({ workStart: '00:00', workEnd: '23:59', breaks: [], rampUpGraceMinutes: 0, restDays: [] }),
    adminId,
  ])

  if (manilaClock.hour < 23 || manilaClock.minute < 59) {
    const nowTs2 = (await db.query('select clock_timestamp() as ts')).rows[0].ts
    const acceptedAfterSettingsReopen = await ingestS05(nowTs2)
    assert.equal(acceptedAfterSettingsReopen.state_applied, true)
    assert.equal(acceptedAfterSettingsReopen.event_value.metadata.outputAccepted, true)
    assert.equal(await acceptedS05Count(), 6)
  }

  // 11. Privilege check: anon/authenticated cannot invoke is_machine_output_schedule_eligible
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role};`)
    await assert.rejects(
      db.query('select public.is_machine_output_schedule_eligible($1, now())', [machineId]),
      /permission denied/i,
    )
    await db.exec('reset role;')
  }

  // 12. Idempotent reapply
  const migration061 = fs.readFileSync(
    path.join(databaseRoot, 'migrations', '061_reject_s05_output_outside_schedule.sql'),
    'utf8',
  )
  await db.exec(migration061)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 61)

  const migration062 = fs.readFileSync(
    path.join(databaseRoot, 'migrations', '062_preserve_s05_same_boot_isp_outage_cuts.sql'),
    'utf8',
  )
  await db.exec(migration062)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 62)
})

test('delayed S-05 output pulses recorded while S-03 was online and running are accepted even if S-03 later faults or goes offline before upload', async (t) => {
  const controlDb = await database(t)
  const delayedDb = await database(t)

  async function sendS03Heartbeat(db, bootId, seq, recordedAt) {
    return (await db.query(`
      select result.*
      from public.sensors sensor
      cross join lateral public.ingest_iot_heartbeat($1, sensor.id, sensor.machine_id, 1, $2, $3, $4::timestamptz, true) result
      where sensor.sensor_code = 'S-03'
    `, [randomUUID(), bootId, seq, recordedAt])).rows[0]
  }

  async function ingestEvent(db, sensorCode, eventType, recordedAt, eventId = randomUUID()) {
    const signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active'
    return (await db.query(`
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
    `, [eventId, eventType, JSON.stringify({ signal, metadata: {} }), recordedAt, sensorCode])).rows[0]
  }

  async function acceptedCount(db) {
    const { rows } = await db.query(`
      select count(*)::int as count
      from public.sensor_events event
      join public.sensors sensor on sensor.id = event.sensor_id
      where sensor.sensor_code = 'S-05'
        and event.event_type = 'pulse'
        and event.output_accepted is true
    `)
    return rows[0].count
  }

  const cutTimes = [
    '2026-08-21T09:00:05+08:00',
    '2026-08-21T09:00:10+08:00',
    '2026-08-21T09:00:15+08:00',
    '2026-08-21T09:00:20+08:00',
  ]

  // 1. Control DB: S-03 online + running at 09:00:00, four working-time cuts delivered immediately
  const controlBootId = randomUUID()
  await sendS03Heartbeat(controlDb, controlBootId, 1, '2026-08-21T09:00:00+08:00')
  await ingestEvent(controlDb, 'S-03', 'pulse', '2026-08-21T09:00:00+08:00')
  for (const cutAt of cutTimes) {
    const res = await ingestEvent(controlDb, 'S-05', 'pulse', cutAt)
    assert.equal(res.event_value.metadata.outputAccepted, true)
    assert.equal(res.event_value.metadata.outputRejectionReason, null)
  }
  assert.equal(await acceptedCount(controlDb), 4)

  // 2. Delayed DB Part A: S-03 is online + running at 09:00:00, then faults (Downtime) at 09:01:00 before S-05 uploads 09:00:05 & 09:00:10
  const delayedBootId = randomUUID()
  await sendS03Heartbeat(delayedDb, delayedBootId, 1, '2026-08-21T09:00:00+08:00')
  await ingestEvent(delayedDb, 'S-03', 'pulse', '2026-08-21T09:00:00+08:00')
  const faultAt0901 = await ingestEvent(delayedDb, 'S-03', 'fault', '2026-08-21T09:01:00+08:00')
  assert.equal(faultAt0901.new_machine_status, 'Downtime')
  assert.equal(faultAt0901.downtime_action, 'created')

  const cut1Id = randomUUID()
  const delayedCut1 = await ingestEvent(delayedDb, 'S-05', 'pulse', cutTimes[0], cut1Id)
  assert.equal(delayedCut1.state_applied, true)
  assert.equal(delayedCut1.event_value.metadata.outputAccepted, true)
  assert.equal(delayedCut1.event_value.metadata.outputRejectionReason, null)

  // Exact duplicate retry of delayedCut1 while machine is in Downtime must remain idempotent and accepted
  const retryCut1 = await ingestEvent(delayedDb, 'S-05', 'pulse', cutTimes[0], cut1Id)
  assert.equal(retryCut1.duplicate, true)
  assert.equal(retryCut1.event_value.metadata.outputAccepted, true)

  // Rapid 50ms bounce after delayedCut1 still rejects as server_debounce
  const delayedBounce = await ingestEvent(delayedDb, 'S-05', 'pulse', '2026-08-21T09:00:05.050+08:00')
  assert.equal(delayedBounce.event_value.metadata.outputAccepted, false)
  assert.equal(delayedBounce.event_value.metadata.outputRejectionReason, 'server_debounce')

  const delayedCut2 = await ingestEvent(delayedDb, 'S-05', 'pulse', cutTimes[1])
  assert.equal(delayedCut2.state_applied, true)
  assert.equal(delayedCut2.event_value.metadata.outputAccepted, true)
  assert.equal(delayedCut2.event_value.metadata.outputRejectionReason, null)

  // A cut recorded at or after 09:01:00 (during actual downtime) must still be rejected as machine_downtime,
  // and machine must remain in Downtime with its 09:01:00 open downtime untouched
  const cutDuringOpenDowntime = await ingestEvent(delayedDb, 'S-05', 'pulse', '2026-08-21T09:01:05+08:00')
  assert.equal(cutDuringOpenDowntime.state_applied, false)
  assert.equal(cutDuringOpenDowntime.event_value.metadata.outputAccepted, false)
  assert.equal(cutDuringOpenDowntime.event_value.metadata.outputRejectionReason, 'machine_downtime')
  assert.equal((await delayedDb.query("select status from public.machines where machine_code = 'M-01'")).rows[0].status, 'Downtime')
  assert.equal((await delayedDb.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 1)

  // 3. Delayed DB Part B: S-03 recovers at 09:01:30, then goes offline at 09:02:10 before S-05 uploads 09:00:15 & 09:00:20
  await ingestEvent(delayedDb, 'S-03', 'recovered', '2026-08-21T09:01:30+08:00')
  const s03Id = (await delayedDb.query("select id from public.sensors where sensor_code = 'S-03'")).rows[0].id
  await delayedDb.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'offline',
      last_heartbeat_received_at = clock_timestamp() - interval '60 seconds',
      last_activity_received_at = clock_timestamp() - interval '60 seconds',
      last_evaluated_at = '2026-08-21T09:02:10+08:00'::timestamptz
    where sensor_id = $1
  `, [s03Id])

  const delayedCut3 = await ingestEvent(delayedDb, 'S-05', 'pulse', cutTimes[2])
  assert.equal(delayedCut3.state_applied, true)
  assert.equal(delayedCut3.event_value.metadata.outputAccepted, true)
  assert.equal(delayedCut3.event_value.metadata.outputRejectionReason, null)

  const delayedCut4 = await ingestEvent(delayedDb, 'S-05', 'pulse', cutTimes[3])
  assert.equal(delayedCut4.state_applied, true)
  assert.equal(delayedCut4.event_value.metadata.outputAccepted, true)
  assert.equal(delayedCut4.event_value.metadata.outputRejectionReason, null)

  // A cut recorded during the closed 09:01:00..09:01:30 downtime window must still be rejected as machine_downtime
  const cutDuringClosedDowntime = await ingestEvent(delayedDb, 'S-05', 'pulse', '2026-08-21T09:01:15+08:00')
  assert.equal(cutDuringClosedDowntime.state_applied, false)
  assert.equal(cutDuringClosedDowntime.event_value.metadata.outputAccepted, false)
  assert.equal(cutDuringClosedDowntime.event_value.metadata.outputRejectionReason, 'machine_downtime')

  // A cut recorded at 09:02:20 (after S-03 went offline and >30s after S-03's last contact at 09:01:30) must be rejected as machine_offline
  const cutWhileActuallyOffline = await ingestEvent(delayedDb, 'S-05', 'pulse', '2026-08-21T09:02:20+08:00')
  assert.equal(cutWhileActuallyOffline.state_applied, false)
  assert.equal(cutWhileActuallyOffline.event_value.metadata.outputAccepted, false)
  assert.equal(cutWhileActuallyOffline.event_value.metadata.outputRejectionReason, 'machine_offline')

  // Immediate delivery and delayed delivery of the 4 valid working-time cuts produce the exact same accepted production count
  assert.equal(await acceptedCount(delayedDb), await acceptedCount(controlDb))

  // 4. S-03 reconnects at 09:05:00..09:05:40 (online for >30s via 10s heartbeats without new S-03 events), then goes offline at 09:06:00:
  //    - a cut recorded at 09:03:00 (during the 09:02:10..09:05:10 offline gap) uploaded AFTER reconnect is still rejected as machine_offline
  //    - a cut recorded at 09:05:12 (while S-03 was online, >30s before S-03's final 09:05:50 heartbeat) uploaded AFTER S-03 goes offline at 09:06:00 is still accepted
  await sendS03Heartbeat(delayedDb, delayedBootId, 2, '2026-08-21T09:05:00+08:00')
  const reconnected = await sendS03Heartbeat(delayedDb, delayedBootId, 3, '2026-08-21T09:05:10+08:00')
  assert.equal(reconnected.connectivity_state, 'online')
  const cutFromPriorOfflineGap = await ingestEvent(delayedDb, 'S-05', 'pulse', '2026-08-21T09:03:00+08:00')
  assert.equal(cutFromPriorOfflineGap.event_value.metadata.outputAccepted, false)
  assert.equal(cutFromPriorOfflineGap.event_value.metadata.outputRejectionReason, 'machine_offline')

  // A cut recorded at 09:01:45 (after S-03 recovered at 09:01:30 and before S-03 went offline at 09:02:10) uploaded after reconnect is accepted
  const cutAfterEventBeforeOffline = await ingestEvent(delayedDb, 'S-05', 'pulse', '2026-08-21T09:01:45+08:00')
  assert.equal(cutAfterEventBeforeOffline.event_value.metadata.outputAccepted, true)
  assert.equal(cutAfterEventBeforeOffline.event_value.metadata.outputRejectionReason, null)

  for (let seq = 4, sec = 20; sec <= 50; seq++, sec += 10) {
    await sendS03Heartbeat(delayedDb, delayedBootId, seq, `2026-08-21T09:05:${sec}+08:00`)
  }
  await delayedDb.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'offline',
      ordered_recovery_heartbeats = 0,
      last_heartbeat_received_at = clock_timestamp() - interval '60 seconds',
      last_activity_received_at = clock_timestamp() - interval '60 seconds',
      last_evaluated_at = '2026-08-21T09:06:00+08:00'::timestamptz
    where sensor_id = $1
  `, [s03Id])
  const cutFromEarlierInOnlineSession = await ingestEvent(delayedDb, 'S-05', 'pulse', '2026-08-21T09:05:12+08:00')
  assert.equal(cutFromEarlierInOnlineSession.event_value.metadata.outputAccepted, true)
  assert.equal(cutFromEarlierInOnlineSession.event_value.metadata.outputRejectionReason, null)
})

test('S-01, S-02, S-04 preserve working-hour faults across breaks/after-hours idle, clear off-schedule faults with unrelated S-03 downtime, and recover cleanly in observe/disabled modes', async (t) => {
  const db = await database(t)

  async function ingest(sensorCode, eventType, recordedAt, metadata = {}) {
    const signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active'
    return (await db.query(`
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
    `, [randomUUID(), eventType, JSON.stringify({ signal, metadata }), recordedAt, sensorCode])).rows[0]
  }

  async function sensorRow(sensorCode) {
    return (await db.query('select id, machine_id, status, fault_source from public.sensors where sensor_code = $1', [sensorCode])).rows[0]
  }

  async function watchdogRow(sensorCode) {
    return (await db.query(`
      select state.detection_state, state.recovery_started_at, state.recovery_observation_count
      from public.sensor_watchdog_state state
      join public.sensors sensor on sensor.id = state.sensor_id
      where sensor.sensor_code = $1
    `, [sensorCode])).rows[0]
  }

  async function activeProcessAlert(sensorCode) {
    return (await db.query(`
      select alert.status, alert.metadata
      from public.alerts alert
      join public.sensors sensor on sensor.id = alert.sensor_id
      where sensor.sensor_code = $1
        and alert.source_type = 'sensor'
        and alert.status in ('Active', 'Acknowledged')
      order by alert.created_at desc
      limit 1
    `, [sensorCode])).rows[0]
  }

  await db.query(`
    update public.machine_operational_settings
    set sensor_thresholds = sensor_thresholds
      || '{"S-01":{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60},"S-02":{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60},"S-03":{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60,"rotationStallMs":3000},"S-04":{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60}}'::jsonb
  `)

  // Default shift on working Friday 2026-11-13: 08:00-17:00 Manila, Lunch Break 12:00-13:00 (+10m ramp-up)
  // 1. Bug 1: Working-hour faults on S-01 (absence_watchdog) and S-02 + S-04 (explicit ESP32 absence fault opening grouped downtime)
  //    MUST survive lunch break ESP32 idle(detectionState='IDLE') instead of clearing Fault or resolving downtime
  const s01 = await sensorRow('S-01')
  const s02 = await sensorRow('S-02')
  const s04 = await sensorRow('S-04')
  const s03 = await sensorRow('S-03')

  await db.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'online',
      detection_state = 'healthy',
      last_heartbeat_id = gen_random_uuid(),
      last_heartbeat_payload_hash = 'process-tdd-fixture',
      last_heartbeat_received_at = '2026-11-13T03:55:00Z'::timestamptz,
      last_activity_received_at = '2026-11-13T03:54:00Z'::timestamptz,
      absence_baseline_at = '2026-11-13T03:54:00Z'::timestamptz
    where sensor_id = any($1::uuid[])
  `, [[s01.id, s02.id, s03.id, s04.id]])

  // 11:55 Manila (03:55 UTC): S-01 reaches absence_watchdog fault
  await db.query("select * from public.evaluate_sensor_watchdog($1, '2026-11-13T03:55:00Z'::timestamptz, 'enforce', 300)", [s01.id])
  assert.deepEqual(
    { status: (await sensorRow('S-01')).status, fault_source: (await sensorRow('S-01')).fault_source },
    { status: 'Fault', fault_source: 'absence_watchdog' },
  )

  // 11:56 Manila (03:56 UTC): S-02 and S-04 report working-hour explicit ESP32 absence faults -> grouped downtime opens!
  await ingest('S-02', 'fault', '2026-11-13T03:56:00Z', { wireState: 'ABSENT', detectionState: 'FAULT' })
  const groupedOpened = await ingest('S-04', 'fault', '2026-11-13T03:56:05Z', { wireState: 'ABSENT', detectionState: 'FAULT' })
  assert.equal(groupedOpened.downtime_action, 'created')
  assert.equal(groupedOpened.new_machine_status, 'Downtime')

  // 12:05 Manila (04:05 UTC, lunch break -> not v_is_eligible): ESP32 receives x-absence-enabled=false and sends idle(IDLE)
  const s01LunchIdle = await ingest('S-01', 'idle', '2026-11-13T04:05:00Z', { coilState: 'ABSENT', detectionState: 'IDLE' })
  const s02LunchIdle = await ingest('S-02', 'idle', '2026-11-13T04:05:01Z', { wireState: 'ABSENT', detectionState: 'IDLE' })
  const s04LunchIdle = await ingest('S-04', 'idle', '2026-11-13T04:05:02Z', { wireState: 'ABSENT', detectionState: 'IDLE' })

  assert.equal((await sensorRow('S-01')).status, 'Fault', 'S-01 working-hour absence_watchdog fault must survive lunch idle')
  assert.equal((await sensorRow('S-02')).status, 'Fault', 'S-02 working-hour explicit fault must survive lunch idle')
  assert.equal((await sensorRow('S-04')).status, 'Fault', 'S-04 working-hour explicit fault must survive lunch idle')
  assert.equal(s04LunchIdle.new_machine_status, 'Downtime', 'Grouped working-hour downtime must stay Open during lunch idle')
  assert.equal((await db.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 1)
  assert.equal((await activeProcessAlert('S-01')).metadata.recoveryPending, undefined)
  assert.equal((await activeProcessAlert('S-02')).metadata.recoveryPending, undefined)
  assert.equal(s01LunchIdle.state_applied, true)
  assert.equal(s02LunchIdle.state_applied, true)

  // Material returns during lunch / work -> clear working-hour faults cleanly for subsequent checks
  const s01Recovered = await ingest('S-01', 'recovered', '2026-11-13T04:06:00Z', { coilState: 'PRESENT', detectionState: 'RUNNING', recoveryConfirmed: true })
  assert.equal(s01Recovered.downtime_action, 'resolved')
  await ingest('S-02', 'recovered', '2026-11-13T04:06:01Z', { wireState: 'PRESENT', detectionState: 'RUNNING', recoveryConfirmed: true })
  await ingest('S-04', 'recovered', '2026-11-13T04:06:02Z', { wireState: 'PRESENT', detectionState: 'RUNNING', recoveryConfirmed: true })
  assert.equal((await sensorRow('S-01')).status, 'Active')

  // 2. Off-schedule false ESP32 fault clears cleanly on watchdog evaluate after hours (within 5s cycle)
  await db.query(`
    insert into public.sensor_events (sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at)
    values ($1, $2, $3, 'fault', '{"signal":"fault","metadata":{"coilState":"ABSENT","detectionState":"FAULT"}}'::jsonb, '2026-11-13T13:10:00Z'::timestamptz)
  `, [s01.id, s01.machine_id, randomUUID()])
  await db.query("update public.sensors set status = 'Fault', fault_source = 'explicit', last_applied_recorded_at = '2026-11-13T13:10:00Z'::timestamptz where id = $1", [s01.id])
  await db.query(`
    update public.alerts set status = 'Resolved', resolved_at = clock_timestamp() where sensor_id = $1 and status in ('Active', 'Acknowledged')
  `, [s01.id])
  await ingest('S-01', 'idle', '2026-11-13T13:11:00Z', { coilState: 'ABSENT', detectionState: 'IDLE' })
  await db.query("select * from public.evaluate_sensor_watchdog($1, '2026-11-13T13:11:05Z'::timestamptz, 'enforce', 300)", [s01.id])
  assert.deepEqual(
    { status: (await sensorRow('S-01')).status, fault_source: (await sensorRow('S-01')).fault_source },
    { status: 'Inactive', fault_source: null },
  )

  // 3. Bug 3: Unrelated working-hour S-03 downtime must NOT block S-01/S-02/S-04 off-schedule false fault auto-clear
  await ingest('S-03', 'fault', '2026-11-13T01:00:00Z', { reason: 'spindle_jam' })
  assert.equal((await db.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 1)

  for (const [code, row] of [['S-01', s01], ['S-02', s02], ['S-04', s04]]) {
    await db.query(`
      insert into public.sensor_events (sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at)
      values ($1, $2, $3, 'fault', '{"signal":"fault","metadata":{"detectionState":"FAULT"}}'::jsonb, '2026-11-13T13:15:00Z'::timestamptz)
    `, [row.id, row.machine_id, randomUUID()])
    await db.query("update public.sensors set status = 'Fault', fault_source = 'explicit', last_applied_recorded_at = '2026-11-13T13:15:00Z'::timestamptz where id = $1", [row.id])
    const evalSuspended = (await db.query(
      "select * from public.evaluate_sensor_watchdog($1, '2026-11-13T13:16:00Z'::timestamptz, 'enforce', 300)",
      [row.id],
    )).rows[0]
    assert.equal(evalSuspended.detection_state, 'suspended', `Expected ${code} suspended after hours`)
    assert.deepEqual(
      { status: (await sensorRow(code)).status, fault_source: (await sensorRow(code)).fault_source },
      { status: 'Inactive', fault_source: null },
      `Expected ${code} off-schedule fault to auto-clear even while S-03 holds an open working-hour downtime`,
    )
  }
  assert.equal((await db.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 1)
  await ingest('S-03', 'recovered', '2026-11-13T13:17:00Z', { reason: 'spindle_cleared' })
  assert.equal((await db.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 0)

  // 4. Bug 2: Working-hour absence_watchdog faults on S-01, S-02, S-04 must clear both via confirmed pulse
  //    AND when watchdog runs in observe mode and finishes recoverySeconds (timestamps advance monotonically to Monday 2026-11-16)
  //    Subcase 4a: pulse with recoveryConfirmed=true (emitted when WATCHDOG_MODE=disabled/observe)
  await db.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'online',
      detection_state = 'downtime',
      last_heartbeat_received_at = '2026-11-16T01:30:00Z'::timestamptz,
      last_activity_received_at = '2026-11-16T01:28:00Z'::timestamptz,
      absence_baseline_at = '2026-11-16T01:28:00Z'::timestamptz
    where sensor_id = $1
  `, [s02.id])
  await db.query("update public.sensors set status = 'Fault', fault_source = 'absence_watchdog' where id = $1", [s02.id])

  const confirmedPulse = await ingest('S-02', 'pulse', '2026-11-16T01:30:05Z', {
    wireState: 'PRESENT',
    detectionState: 'RUNNING',
    recoveryConfirmed: true,
  })
  assert.equal(confirmedPulse.state_applied, true)
  assert.deepEqual(
    { status: (await sensorRow('S-02')).status, fault_source: (await sensorRow('S-02')).fault_source },
    { status: 'Active', fault_source: null },
  )
  assert.equal((await watchdogRow('S-02')).detection_state, 'healthy')

  //    Subcase 4b: observe-mode evaluate_sensor_watchdog completing recovery clears prior absence_watchdog Fault + alert + downtime
  //    Seed Active process alert for S-01 and Acknowledged alert for S-04 so both alert resolution paths are verified
  for (const row of [s01, s02, s04]) {
    await db.query("update public.sensors set status = 'Fault', fault_source = 'absence_watchdog' where id = $1", [row.id])
    await db.query(`
      update public.sensor_watchdog_state
      set connectivity_state = 'online',
        detection_state = 'recovering',
        recovery_started_at = '2026-11-16T01:35:00Z'::timestamptz,
        recovery_observation_count = 2,
        last_heartbeat_received_at = '2026-11-16T01:36:05Z'::timestamptz,
        last_activity_received_at = '2026-11-16T01:36:00Z'::timestamptz
      where sensor_id = $1
    `, [row.id])
  }
  await db.query("update public.alerts set status = 'Resolved', resolved_at = clock_timestamp() where status in ('Active', 'Acknowledged')")
  await db.query(`
    insert into public.alerts (source_type, source_id, machine_id, sensor_id, severity, status, title, message, metadata)
    values
      ('sensor', $1, $3, $1, 'Warning', 'Active', 'Raw Material & Coil Joint process issue detected', 'S-01 sustained activity is absent.', '{"sensorCode":"S-01","processFault":true}'::jsonb),
      ('sensor', $2, $3, $2, 'Warning', 'Acknowledged', 'Outside Filler Wire process issue detected', 'S-04 sustained activity is absent.', '{"sensorCode":"S-04","processFault":true}'::jsonb)
  `, [s01.id, s04.id, s03.machine_id])
  await db.query(`
    insert into public.downtime_events (machine_id, sensor_id, started_at, cause, status, detection_source)
    values ($1, $2, '2026-11-16T01:34:00Z'::timestamptz, 'Pending Cause Review', 'Open', 'absence_watchdog')
  `, [s03.machine_id, s03.id])
  await db.query("update public.machines set status = 'Downtime' where id = $1", [s03.machine_id])

  for (const code of ['S-01', 'S-02', 'S-04']) {
    const id = (await sensorRow(code)).id
    const evalObserve = (await db.query(
      "select * from public.evaluate_sensor_watchdog($1, '2026-11-16T01:36:05Z'::timestamptz, 'observe', 300)",
      [id],
    )).rows[0]
    assert.equal(evalObserve.detection_state, 'healthy')
    assert.deepEqual(
      { status: (await sensorRow(code)).status, fault_source: (await sensorRow(code)).fault_source },
      { status: 'Active', fault_source: null },
      `Expected ${code} stale absence_watchdog Fault to clear once observe watchdog completes recovery`,
    )
  }
  assert.equal((await activeProcessAlert('S-01')).metadata.recoveryPending, true)
  assert.equal(
    (await db.query("select status from public.alerts where sensor_id = $1 and source_type = 'sensor' order by created_at desc limit 1", [s04.id])).rows[0].status,
    'Resolved',
  )
  assert.equal((await db.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 0)
  assert.equal((await db.query("select status from public.machines where id = $1", [s03.machine_id])).rows[0].status, 'Running')

  //    Subcase 4c: observe-mode recovery also clears stale absence_watchdog Fault when absenceDetectionEnabled was turned off in Settings
  await db.query("update public.sensors set status = 'Fault', fault_source = 'absence_watchdog' where id = $1", [s03.id])
  await db.query(`
    insert into public.downtime_events (machine_id, sensor_id, started_at, cause, status, detection_source)
    values ($1, $2, '2026-11-16T01:40:00Z'::timestamptz, 'Pending Cause Review', 'Open', 'absence_watchdog')
  `, [s03.machine_id, s03.id])
  await db.query("update public.machines set status = 'Downtime' where id = $1", [s03.machine_id])
  const currentSettings = (await db.query('select version, sensor_thresholds, shift_schedule from public.machine_operational_settings limit 1')).rows[0]
  await db.query('select * from public.update_machine_operational_settings($1, $2, $3::jsonb, $4::jsonb, null)', [
    s03.machine_id,
    currentSettings.version,
    JSON.stringify({
      ...currentSettings.sensor_thresholds,
      'S-03': { ...currentSettings.sensor_thresholds['S-03'], absenceDetectionEnabled: false },
    }),
    JSON.stringify(currentSettings.shift_schedule),
  ])
  const evalDisabledObserve = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-11-16T01:41:00Z'::timestamptz, 'observe', 300)",
    [s03.id],
  )).rows[0]
  assert.equal(evalDisabledObserve.detection_state, 'disabled')
  assert.deepEqual(
    { status: (await sensorRow('S-03')).status, fault_source: (await sensorRow('S-03')).fault_source },
    { status: 'Inactive', fault_source: null },
  )
  assert.equal((await db.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 0)
  assert.equal((await db.query("select status from public.machines where id = $1", [s03.machine_id])).rows[0].status, 'Idle')

  //    Subcase 4d: normal observe-mode evaluation without prior absence_watchdog fault still leaves sensor status untouched
  await db.query("update public.sensors set status = 'Active', fault_source = null where id = $1", [s01.id])
  await db.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'online',
      detection_state = 'healthy',
      last_heartbeat_received_at = '2026-11-16T02:32:00Z'::timestamptz,
      last_activity_received_at = '2026-11-16T02:30:00Z'::timestamptz,
      absence_baseline_at = '2026-11-16T02:30:00Z'::timestamptz
    where sensor_id = $1
  `, [s01.id])
  const normalObserve = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-11-16T02:32:00Z'::timestamptz, 'observe', 300)",
    [s01.id],
  )).rows[0]
  assert.equal(normalObserve.detection_state, 'downtime')
  assert.deepEqual(normalObserve.transition_descriptors.filter((d) => d.kind === 'alert' || d.kind === 'downtime'), [])
  assert.deepEqual(
    { status: (await sensorRow('S-01')).status, fault_source: (await sensorRow('S-01')).fault_source },
    { status: 'Active', fault_source: null },
  )
})

test('migration 060 standalone shares confirmed-pulse and unrelated S-03 downtime auto-clear fixes for S-01, S-02, S-04', async (t) => {
  const db = await database(t, 60)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 60)

  const s03 = (await db.query("select id, machine_id from public.sensors where sensor_code = 'S-03'")).rows[0]
  const s04 = (await db.query("select id, machine_id from public.sensors where sensor_code = 'S-04'")).rows[0]

  await db.query(`
    update public.machine_operational_settings
    set sensor_thresholds = sensor_thresholds
      || '{"S-03":{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60,"rotationStallMs":3000},"S-04":{"absenceDetectionEnabled":true,"triggerSeconds":60,"recoverySeconds":60}}'::jsonb
  `)
  await db.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'online',
      detection_state = 'healthy',
      last_heartbeat_id = gen_random_uuid(),
      last_heartbeat_payload_hash = 'standalone-060',
      last_heartbeat_received_at = '2026-11-16T01:00:00Z'::timestamptz,
      last_activity_received_at = '2026-11-16T01:00:00Z'::timestamptz
    where sensor_id = any($1::uuid[])
  `, [[s03.id, s04.id]])

  await db.query(`
    select * from public.ingest_iot_sensor_event($1, $2, $3, 'fault', '{"signal":"fault","metadata":{"reason":"spindle"}}'::jsonb, '2026-11-16T01:00:00Z'::timestamptz)
  `, [randomUUID(), s03.id, s03.machine_id])
  await db.query(`
    insert into public.sensor_events (sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at)
    values ($1, $2, $3, 'fault', '{"signal":"fault","metadata":{"detectionState":"FAULT"}}'::jsonb, '2026-11-16T13:05:00Z'::timestamptz)
  `, [s04.id, s04.machine_id, randomUUID()])
  await db.query("update public.sensors set status = 'Fault', fault_source = 'explicit', last_applied_recorded_at = '2026-11-16T13:05:00Z'::timestamptz where id = $1", [s04.id])

  const evalS04 = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-11-16T13:06:00Z'::timestamptz, 'enforce', 300)",
    [s04.id],
  )).rows[0]
  assert.equal(evalS04.detection_state, 'suspended')
  assert.equal((await db.query('select status from public.sensors where id = $1', [s04.id])).rows[0].status, 'Inactive')
  assert.equal((await db.query("select count(*)::int as c from public.downtime_events where status = 'Open'")).rows[0].c, 1)

  await db.query("update public.sensors set status = 'Fault', fault_source = 'absence_watchdog' where id = $1", [s04.id])
  await db.query("update public.sensor_watchdog_state set detection_state = 'downtime', connectivity_state = 'online' where sensor_id = $1", [s04.id])
  await db.query(`
    select * from public.ingest_iot_sensor_event($1, $2, $3, 'pulse', '{"signal":"active","metadata":{"wireState":"PRESENT","detectionState":"RUNNING","recoveryConfirmed":true}}'::jsonb, '2026-11-16T13:07:00Z'::timestamptz)
  `, [randomUUID(), s04.id, s04.machine_id])
  assert.deepEqual(
    (await db.query('select status, fault_source from public.sensors where id = $1', [s04.id])).rows[0],
    { status: 'Active', fault_source: null },
  )
  assert.equal(
    (await db.query('select detection_state from public.sensor_watchdog_state where sensor_id = $1', [s04.id])).rows[0].detection_state,
    'suspended',
  )

  const migration060 = fs.readFileSync(
    path.join(databaseRoot, 'migrations', '060_reject_s05_output_when_s03_offline.sql'),
    'utf8',
  )
  await db.exec(migration060)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 60)
})

test('Finding #8: lost-ACK retry with drifted metadata rejects 22023 while frozen capture metadata stays idempotent', async (t) => {
  const db = await database(t)
  const eventId = randomUUID()
  const recordedAt = '2026-08-21T09:05:00+08:00'

  const sendGrouped = (rssi) => db.query(`
    select result.*
    from public.sensors sensor
    cross join lateral public.ingest_iot_grouped_sensor_event(
      $1::uuid,
      sensor.id,
      sensor.machine_id,
      'fault',
      $2::jsonb,
      $3::timestamptz
    ) result
    where sensor.sensor_code = 'S-01'
  `, [
    eventId,
    JSON.stringify({ signal: 'fault', metadata: { rssi, coilState: 'ABSENT', detectionState: 'FAULT' } }),
    recordedAt,
  ])

  const first = (await sendGrouped(-60)).rows[0]
  assert.equal(first.duplicate, false)
  assert.equal(first.state_applied, true)

  // Unfrozen metadata rebuild after RSSI drift fails idempotency check with 22023.
  await assert.rejects(
    sendGrouped(-64),
    (err) => err.code === '22023',
  )

  // Frozen capture-time metadata returns idempotent duplicate without second state mutation.
  const frozenRetry = (await sendGrouped(-60)).rows[0]
  assert.equal(frozenRetry.duplicate, true)
  assert.equal(frozenRetry.state_applied, false)
})

test('Finding #9: offline recovery requires two heartbeats within 30s and resets counter after stale gap', async (t) => {
  const db = await database(t)
  const bootId = randomUUID()
  const sensor = (await db.query("select id, machine_id from public.sensors where sensor_code = 'S-03'")).rows[0]

  const sendHb = (seq, recordedAt) => db.query(`
    select * from public.ingest_iot_heartbeat($1, $2, $3, 1, $4, $5, $6::timestamptz, false)
  `, [randomUUID(), sensor.id, sensor.machine_id, bootId, seq, recordedAt])

  // Seed same-boot offline sensor (sequence 5) before recovery attempt.
  await sendHb(5, '2026-08-21T09:00:00+08:00')
  await db.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'offline',
        ordered_recovery_heartbeats = 0,
        last_heartbeat_received_at = clock_timestamp() - interval '120 seconds'
    where sensor_id = $1
  `, [sensor.id])

  // Recovery heartbeat #1 at T0 moves count to 1 while remaining offline.
  const hb1 = (await sendHb(6, '2026-08-21T09:02:00+08:00')).rows[0]
  assert.equal(hb1.connectivity_state, 'offline')

  // Simulate 120s gap before next heartbeat arrives (stale recovery streak).
  await db.query(`
    update public.sensor_watchdog_state
    set last_heartbeat_received_at = clock_timestamp() - interval '120 seconds'
    where sensor_id = $1
  `, [sensor.id])

  // Recovery heartbeat #2 arriving 120s later must reset streak to 1 and stay offline.
  const hb2StaleGap = (await sendHb(7, '2026-08-21T09:04:00+08:00')).rows[0]
  assert.equal(hb2StaleGap.connectivity_state, 'offline')

  // Consecutive heartbeat #3 arriving 10s after #2 completes 2-in-30s recovery -> online.
  const hb3Within30s = (await sendHb(8, '2026-08-21T09:04:10+08:00')).rows[0]
  assert.equal(hb3Within30s.connectivity_state, 'online')
})

test('Finding #10: delayed heartbeat stamps last_activity_received_at from p_recorded_at (clamped +5s skew), not clock_timestamp()', async (t) => {
  const db = await database(t)
  const bootId = randomUUID()
  const sensor = (await db.query("select id, machine_id from public.sensors where sensor_code = 'S-03'")).rows[0]

  // Send delayed heartbeat whose device activity happened 90s before server receipt.
  const delayedAtRes = await db.query(
    "select date_trunc('milliseconds', clock_timestamp() - interval '90 seconds') as recorded_at",
  )
  const delayedRecordedAt = new Date(delayedAtRes.rows[0].recorded_at)

  const hb = (await db.query(`
    select * from public.ingest_iot_heartbeat($1, $2, $3, 1, $4, 1, $5::timestamptz, true)
  `, [randomUUID(), sensor.id, sensor.machine_id, bootId, delayedRecordedAt.toISOString()])).rows[0]

  const state = (await db.query(
    'select last_activity_received_at, absence_baseline_at from public.sensor_watchdog_state where sensor_id = $1',
    [sensor.id],
  )).rows[0]

  const recordedMs = delayedRecordedAt.getTime()
  const storedActivityMs = new Date(state.last_activity_received_at).getTime()
  const serverReceivedMs = new Date(hb.received_at).getTime()

  assert.ok(
    Math.abs(storedActivityMs - recordedMs) <= 50,
    `expected last_activity_received_at (${storedActivityMs}) to match p_recorded_at (${recordedMs}), not server received_at (${serverReceivedMs})`,
  )
  assert.ok(
    storedActivityMs >= new Date(state.absence_baseline_at).getTime(),
    'activity heartbeat on boot/reconnect must keep last_activity_received_at >= absence_baseline_at',
  )
  assert.ok(
    serverReceivedMs - storedActivityMs >= 85000,
    'server receipt time must stay ~90s after delayed activity timestamp',
  )

  // Future device clock skew (+120s) is clamped to v_received_at + 5s.
  const skewed = (await db.query(`
    select * from public.ingest_iot_heartbeat(
      $1, $2, $3, 1, $4, 2, clock_timestamp() + interval '120 seconds', true
    )
  `, [randomUUID(), sensor.id, sensor.machine_id, bootId])).rows[0]
  const skewedState = (await db.query(
    'select last_activity_received_at from public.sensor_watchdog_state where sensor_id = $1',
    [sensor.id],
  )).rows[0]
  assert.ok(
    new Date(skewedState.last_activity_received_at).getTime() <= new Date(skewed.received_at).getTime() + 5500,
    'future-skewed p_recorded_at must clamp at v_received_at + 5s',
  )
})

test('S-05 rejects pre-first-boot cuts, clock-lagged S-03 recovery unblocks future S-05 cuts, and pre-baseline heartbeat does not recover downtime', async (t) => {
  const db = await database(t)
  const bootId = randomUUID()
  const s03 = (await db.query("select id, machine_id from public.sensors where sensor_code = 'S-03'")).rows[0]

  const sendS03Hb = (seq, recordedAt, activityObserved = true) => db.query(
    'select * from public.ingest_iot_heartbeat($1, $2, $3, 1, $4, $5, $6::timestamptz, $7)',
    [randomUUID(), s03.id, s03.machine_id, bootId, seq, recordedAt, activityObserved],
  )
  const sendS05Cut = async (recordedAt) => (await db.query(`
    select result.*
    from public.sensors sensor
    cross join lateral public.ingest_iot_sensor_event(
      $1::uuid, sensor.id, sensor.machine_id, 'pulse',
      '{"signal":"active","metadata":{}}'::jsonb, $2::timestamptz
    ) result
    where sensor.sensor_code = 'S-05'
  `, [randomUUID(), recordedAt])).rows[0]

  // 1. S-03 first boots at 09:00:00 -> delayed S-05 cut from 08:30:00 (while S-03 was unknown/unbooted) must reject as machine_offline.
  await sendS03Hb(1, '2026-08-21T09:00:00+08:00', true)
  const preBootCut = await sendS05Cut('2026-08-21T08:30:00+08:00')
  assert.equal(preBootCut.event_value.metadata.outputAccepted, false)
  assert.equal(preBootCut.event_value.metadata.outputRejectionReason, 'machine_offline')

  // 2. Watchdog marks S-03 offline at server 09:05:05, then S-03 recovers with 15s clock lag (09:04:50, 09:05:00) -> S-05 cut at 09:05:20 must accept.
  await db.query(`
    update public.sensor_watchdog_state
    set last_heartbeat_received_at = '2026-08-21T09:04:00+08:00'::timestamptz
    where sensor_id = $1
  `, [s03.id])
  const offlineEval = (await db.query(
    "select * from public.evaluate_sensor_watchdog($1, '2026-08-21T09:05:05+08:00'::timestamptz, 'enforce', 30)",
    [s03.id],
  )).rows[0]
  assert.equal(offlineEval.connectivity_state, 'offline')

  await sendS03Hb(2, '2026-08-21T09:04:50+08:00', true)
  const recoveredHb = (await sendS03Hb(3, '2026-08-21T09:05:00+08:00', true)).rows[0]
  assert.equal(recoveredHb.connectivity_state, 'online')

  const postRecoveryCut = await sendS05Cut('2026-08-21T09:05:20+08:00')
  assert.equal(postRecoveryCut.event_value.metadata.outputAccepted, true)
  assert.equal(postRecoveryCut.event_value.metadata.outputRejectionReason, null)

  // 3. While S-03 is in absence_watchdog downtime (baseline 09:10:00), a delayed pre-baseline heartbeat (09:09:30) must not advance recovery.
  await db.query(`
    update public.sensor_watchdog_state
    set detection_state = 'downtime',
        absence_baseline_at = '2026-08-21T09:10:00+08:00'::timestamptz,
        last_activity_received_at = '2026-08-21T09:10:00+08:00'::timestamptz,
        recovery_started_at = null,
        recovery_observation_count = 0
    where sensor_id = $1
  `, [s03.id])
  await sendS03Hb(4, '2026-08-21T09:09:30+08:00', true)
  const afterStaleHb = (await db.query(
    'select detection_state, recovery_observation_count from public.sensor_watchdog_state where sensor_id = $1',
    [s03.id],
  )).rows[0]
  assert.equal(afterStaleHb.detection_state, 'downtime')
  assert.equal(afterStaleHb.recovery_observation_count, 0)
})

test('migration 062 preserves S-05 cuts across same-boot S-03 ISP outages and 2-heartbeat recovery while rejecting cuts across S-03 reboot or stationary gaps', async (t) => {
  const db = await database(t)
  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 62)

  const s03 = (await db.query("select id, machine_id from public.sensors where sensor_code = 'S-03'")).rows[0]
  const boot1 = randomUUID()
  const boot2 = randomUUID()

  const sendS03Hb = (bootCounter, bootId, seq, recordedAt, activityObserved = true) => db.query(
    'select * from public.ingest_iot_heartbeat($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)',
    [randomUUID(), s03.id, s03.machine_id, bootCounter, bootId, seq, recordedAt, activityObserved],
  )
  const sendEvent = async (sensorCode, eventType, recordedAt) => {
    const signal = eventType === 'idle' ? 'idle' : eventType === 'fault' ? 'fault' : 'active'
    return (await db.query(`
      select result.*
      from public.sensors sensor
      cross join lateral public.ingest_iot_sensor_event(
        $1::uuid, sensor.id, sensor.machine_id, $2::text, $3::jsonb, $4::timestamptz
      ) result
      where sensor.sensor_code = $5
    `, [randomUUID(), eventType, JSON.stringify({ signal, metadata: {} }), recordedAt, sensorCode])).rows[0]
  }

  // Seed S-03 online + Running on boot1 at 09:00:00 Manila.
  await sendS03Hb(1, boot1, 1, '2026-08-21T09:00:00+08:00', true)
  await sendEvent('S-03', 'pulse', '2026-08-21T09:00:00+08:00')

  // 1. ISP outage #1: Watchdog marks S-03 offline at 09:00:35 while mill keeps running on boot1.
  await db.query("update public.sensor_watchdog_state set last_heartbeat_received_at = '2026-08-21T09:00:00+08:00'::timestamptz where sensor_id = $1", [s03.id])
  await db.query("select * from public.evaluate_sensor_watchdog($1, '2026-08-21T09:00:35+08:00'::timestamptz, 'enforce', 30)", [s03.id])

  // S-03 sends Recovery Heartbeat #1 (ordered_recovery_heartbeats = 1, still 'offline') + live running pulse at 09:01:45..46.
  const recHb1 = (await sendS03Hb(1, boot1, 2, '2026-08-21T09:01:45+08:00', true)).rows[0]
  assert.equal(recHb1.connectivity_state, 'offline')
  await sendEvent('S-03', 'pulse', '2026-08-21T09:01:46+08:00')

  // Bug 3B + 3A: FIFO drain in chronological order — 09:01:15 (during ISP outage, uploaded during Hb1),
  // then Heartbeat #2 completes recovery -> 'online', then 09:01:30 (buffered during ISP outage) and 09:01:49 (cut during Hb1 gap) all accept!
  const bufferedDuringHb1 = await sendEvent('S-05', 'pulse', '2026-08-21T09:01:15+08:00')
  assert.equal(bufferedDuringHb1.event_value.metadata.outputAccepted, true)

  const recHb2 = (await sendS03Hb(1, boot1, 3, '2026-08-21T09:01:55+08:00', true)).rows[0]
  assert.equal(recHb2.connectivity_state, 'online')
  const bufferedAfterFullRecovery = await sendEvent('S-05', 'pulse', '2026-08-21T09:01:30+08:00')
  assert.equal(bufferedAfterFullRecovery.event_value.metadata.outputAccepted, true)
  const liveDuringHb1 = await sendEvent('S-05', 'pulse', '2026-08-21T09:01:49+08:00')
  assert.equal(liveDuringHb1.event_value.metadata.outputAccepted, true)

  // 2. Counter-case (Power loss / new boot_id): S-03 goes offline at 09:03:00 and reboots onto boot2 at 09:04:00.
  await db.query("update public.sensor_watchdog_state set last_heartbeat_received_at = '2026-08-21T09:02:00+08:00'::timestamptz where sensor_id = $1", [s03.id])
  await db.query("select * from public.evaluate_sensor_watchdog($1, '2026-08-21T09:03:00+08:00'::timestamptz, 'enforce', 30)", [s03.id])
  await sendS03Hb(2, boot2, 1, '2026-08-21T09:04:00+08:00', true)
  await sendEvent('S-03', 'pulse', '2026-08-21T09:04:01+08:00')

  const cutDuringRebootGap = await sendEvent('S-05', 'pulse', '2026-08-21T09:03:30+08:00')
  assert.equal(cutDuringRebootGap.event_value.metadata.outputAccepted, false)
  assert.equal(cutDuringRebootGap.event_value.metadata.outputRejectionReason, 'machine_offline')
})







