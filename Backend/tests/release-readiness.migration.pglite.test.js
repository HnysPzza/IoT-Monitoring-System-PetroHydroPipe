const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../database')
const releaseSchemaVersion = 45
const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
  .filter((name) => {
    const match = /^(\d{3})_.*\.sql$/.exec(name)
    return match && Number(match[1]) >= 29 && Number(match[1]) <= releaseSchemaVersion
  })
  .sort()
  .map((name) => fs.readFileSync(path.join(databaseRoot, 'migrations', name), 'utf8'))

async function database(t) {
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

test('full migration chain reports release readiness version 45', async (t) => {
  const db = await database(t)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, releaseSchemaVersion)
})

test('password reset migration can be reapplied without lowering readiness', async (t) => {
  const db = await database(t)
  const migration = fs.readFileSync(path.join(databaseRoot, 'migrations', '045_user_password_reset.sql'), 'utf8')

  await db.exec(migration)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, releaseSchemaVersion)
  assert.equal((await db.query(`select count(*)::int as count from pg_attribute
    where attrelid='public.password_setup_tokens'::regclass and attname='purpose' and not attisdropped`)).rows[0].count, 1)
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
