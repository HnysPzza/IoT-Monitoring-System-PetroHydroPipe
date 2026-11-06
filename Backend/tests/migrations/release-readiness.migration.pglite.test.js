const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../../database')
const releaseSchemaVersion = 53

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
