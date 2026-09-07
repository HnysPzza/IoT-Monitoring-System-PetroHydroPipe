const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { createAuthSessionDatabase } = require('./helpers/authSessionDatabase')

test('login session, timestamp, and audit succeed or roll back together', async (context) => {
  const { db, userId } = await createAuthSessionDatabase(context)
  for (const name of ['029_account_onboarding.sql', '030_verify_login_credentials.sql', '031_atomic_login_audit.sql']) {
    const migration = path.resolve(__dirname, '../database/migrations', name)
    await db.exec(fs.readFileSync(migration, 'utf8'))
  }
  await db.exec("create function reject_login_audit() returns trigger language plpgsql as $$ begin if new.action='LOGIN_SUCCESS' then raise exception 'audit unavailable'; end if; return new; end $$; create trigger reject_login_audit before insert on audit_logs for each row execute function reject_login_audit()")
  await assert.rejects(db.query("select issue_refresh_token($1,repeat('a',64),now()+interval '1 hour','hash')", [userId]), /audit unavailable/)
  assert.equal((await db.query('select count(*)::int as count from auth_sessions')).rows[0].count, 0)
  assert.equal((await db.query('select last_login_at from users where id=$1', [userId])).rows[0].last_login_at, null)
  await db.exec('drop trigger reject_login_audit on audit_logs')
  await db.query("select issue_refresh_token($1,repeat('a',64),now()+interval '1 hour','hash')", [userId])
  assert.equal((await db.query("select count(*)::int as count from audit_logs where action='LOGIN_SUCCESS'")).rows[0].count, 1)
  assert.ok((await db.query('select last_login_at from users where id=$1', [userId])).rows[0].last_login_at)
})
