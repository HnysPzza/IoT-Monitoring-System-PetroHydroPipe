const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { createAuthSessionDatabase } = require('./helpers/authSessionDatabase')

test('password changes reject stale login issuance and revoke earlier sessions', async (context) => {
  const { db, userId } = await createAuthSessionDatabase(context)
  await db.exec(fs.readFileSync(path.resolve(__dirname, '../database/migrations/029_account_onboarding.sql'), 'utf8'))
  const migration = path.resolve(__dirname, '../database/migrations/030_verify_login_credentials.sql')
  await db.exec(fs.readFileSync(migration, 'utf8'))
  const issue = (hash, token) => db.query("select issue_refresh_token($1,$2,now()+interval '1 hour',$3)", [userId, token.repeat(64), hash])
  await issue('hash', 'a')
  const replacement = '$2b$10$' + 'a'.repeat(53)
  await db.query('select change_account_password($1,$2,$3)', [userId, 'hash', replacement])
  assert.equal((await db.query('select count(*)::int as count from auth_sessions where revoked_at is null')).rows[0].count, 0)
  await assert.rejects(issue('hash', 'b'), /Credentials changed/)
  await issue(replacement, 'c')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,'issue_refresh_token(uuid,text,timestamptz)','execute') as allowed", [role])).rows[0].allowed, false)
  }
  await db.exec('set role service_role')
  assert.equal((await db.query('select get_backend_readiness() as version')).rows[0].version, 30)
})
