const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { createAuthSessionDatabase } = require('./helpers/authSessionDatabase')

test('operational seed creates no accounts and preserves existing credentials and flags', async (context) => {
  const { db, userId } = await createAuthSessionDatabase(context)
  await db.query("update users set username='admin',must_change_password=false where id=$1", [userId])
  const before = (await db.query('select * from users where id=$1', [userId])).rows[0]
  const seed = fs.readFileSync(path.resolve(__dirname, '../database/seed.sql'), 'utf8')
  await db.exec(seed)
  assert.deepEqual((await db.query('select * from users where id=$1', [userId])).rows[0], before)
  await db.query('delete from users where id=$1', [userId])
  await db.exec(seed)
  assert.equal((await db.query('select count(*)::int as count from users')).rows[0].count, 0)
  assert.equal((await db.query('select count(*)::int as count from sensors')).rows[0].count, 5)
})
