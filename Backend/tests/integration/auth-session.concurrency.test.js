const assert = require('node:assert/strict')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const test = require('node:test')

const enabled = Boolean(process.env.AUTH_REVIEW_PG_PORT)
const psql = process.env.AUTH_REVIEW_PSQL || 'psql'
const databaseName = `auth_session_review_${randomUUID().replaceAll('-', '')}`
const connectionArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.AUTH_REVIEW_PG_PORT || '55439', '-U', 'authreview']
const args = [...connectionArgs, '-d', databaseName]
const execute = promisify(execFile)
const query = async (sql) => (await execute(psql, [...args, '-c', sql])).stdout.trim()

async function holdTransaction(sql) {
  const child = spawn(psql, args, { windowsHide: true })
  let output = ''
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.stderr.on('data', (data) => { output += data })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(output)))
  })
  const ready = new Promise((resolve) => {
    child.stdout.on('data', (data) => {
      output += data
      if (output.includes('review-held')) resolve()
    })
  })
  child.stdin.write(`begin; ${sql}; select 'review-held';\n`)
  await Promise.race([ready, closed.then(() => { throw new Error('Holder exited before acquiring lock') })])
  return async () => { child.stdin.end('commit;\n'); await closed }
}

async function waitForLock(application, finished) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await query(`select count(*) from pg_stat_activity where application_name='${application}' and wait_event_type='Lock'`) !== '0') return true
    if (finished()) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

test.before(async () => {
  if (!enabled) return
  await execute(psql, [...connectionArgs, '-d', 'postgres', '-c', `create database ${databaseName}`])
  await query("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;")
  for (const filename of ['schema.sql', 'migrations/027_harden_auth_sessions.sql']) {
    await execute(psql, [...args, '-f', path.resolve(__dirname, '../../database', filename)])
  }
  await query("insert into roles(name) values ('Admin'),('Production Supervisor'); insert into users(name,username,password_hash,role_id) select 'Bootstrap','bootstrap','hash',id from roles where name='Admin';")
  for (const filename of ['029_account_onboarding.sql', '030_verify_login_credentials.sql', '031_atomic_login_audit.sql']) {
    await execute(psql, [...args, '-f', path.resolve(__dirname, '../../database/migrations', filename)])
  }
})

test.after(async () => {
  if (enabled) await execute(psql, [...connectionArgs, '-d', 'postgres', '-c', `drop database if exists ${databaseName} with (force)`])
})

async function seed() {
  const userId = randomUUID()
  await query(`insert into roles(name) values ('Admin') on conflict (name) do nothing;
    insert into users(id,name,username,email,password_hash,status,role_id) values ('${userId}','Review','${userId}','${userId}@example.test','hash','Active',(select id from roles where name='Production Supervisor'));
    select issue_refresh_token('${userId}',md5('${userId}a')||md5('${userId}a'),now()+interval '8 hours','hash');
    select * from rotate_refresh_token(md5('${userId}a')||md5('${userId}a'),md5('${userId}b')||md5('${userId}b'));`)
  return userId
}

test('real connections serialize successor rotation and ancestor replay', { skip: !enabled, timeout: 30000 }, async () => {
  const userId = await seed()
  const release = await holdTransaction(`select * from rotate_refresh_token(md5('${userId}b')||md5('${userId}b'),md5('${userId}c')||md5('${userId}c'))`)
  let finished = false
  const replay = query(`set application_name='auth-review-replay'; select * from rotate_refresh_token(md5('${userId}a')||md5('${userId}a'),md5('${userId}d')||md5('${userId}d'))`).finally(() => { finished = true })
  try { assert.equal(await waitForLock('auth-review-replay', () => finished), true) } finally { await release() }
  await replay
  assert.equal(await query(`select count(*) from auth_sessions where user_id='${userId}' and revoked_at is null`), '0')
})

test('replay acquires the account lock before changing session rows', { skip: !enabled, timeout: 30000 }, async () => {
  const userId = await seed()
  const release = await holdTransaction(`select id from users where id='${userId}' for no key update`)
  let finished = false
  const replay = query(`set application_name='auth-review-account'; select * from rotate_refresh_token(md5('${userId}a')||md5('${userId}a'),md5('${userId}d')||md5('${userId}d'))`).finally(() => { finished = true })
  let blocked
  try { blocked = await waitForLock('auth-review-account', () => finished) } finally { await release() }
  await replay
  assert.equal(blocked, true)
})

test('password rotation commits before stale login issuance and denies the new session', { skip: !enabled, timeout: 30000 }, async () => {
  const userId = await seed()
  const replacement = '$2b$10$' + 'a'.repeat(53)
  const release = await holdTransaction(`select change_account_password('${userId}','hash','${replacement}')`)
  let finished = false
  const login = query(`set application_name='auth-stale-login'; select issue_refresh_token('${userId}',repeat('e',64),now()+interval '1 hour','hash')`)
    .then(() => null, (error) => error).finally(() => { finished = true })
  try { assert.equal(await waitForLock('auth-stale-login', () => finished), true) } finally { await release() }
  assert.match((await login)?.message || '', /Credentials changed/)
  assert.equal(await query(`select count(*) from auth_sessions where user_id='${userId}' and revoked_at is null`), '0')
})

test('login commits first and concurrent password rotation revokes its session', { skip: !enabled, timeout: 30000 }, async () => {
  const userId = await seed()
  const replacement = '$2b$10$' + 'a'.repeat(53)
  const release = await holdTransaction(`select issue_refresh_token('${userId}',repeat('f',64),now()+interval '1 hour','hash')`)
  let finished = false
  const change = query(`set application_name='auth-password-change'; select change_account_password('${userId}','hash','${replacement}')`).finally(() => { finished = true })
  try { assert.equal(await waitForLock('auth-password-change', () => finished), true) } finally { await release() }
  await change
  assert.equal(await query(`select count(*) from auth_sessions where user_id='${userId}' and revoked_at is null`), '0')
})
