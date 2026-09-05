const fs = require('node:fs')
const path = require('node:path')

async function createAuthSessionDatabase(t) {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto')
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  const directory = path.resolve(__dirname, '../../database')
  await db.exec(fs.readFileSync(path.join(directory, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(directory, 'migrations/026_refresh_tokens.sql'), 'utf8'))
  const migration = path.join(directory, 'migrations/027_harden_auth_sessions.sql')
  if (fs.existsSync(migration)) await db.exec(fs.readFileSync(migration, 'utf8'))
  const roles = await db.query("insert into roles(name) values ('Admin') returning id")
  const users = await db.query("insert into users(name,username,email,password_hash,status,role_id) values ('Test','session-test','session@example.test','hash','Active',$1) returning id", [roles.rows[0].id])
  return { db, userId: users.rows[0].id }
}

module.exports = { createAuthSessionDatabase }
