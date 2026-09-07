const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'disposable-browser-review-secret-only',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  CORS_ORIGIN: 'http://localhost:5175',
  WATCHDOG_MODE: 'disabled',
  ACCESS_TOKEN_EXPIRES_MINUTES: '30',
  REFRESH_TOKEN_TTL_MINUTES: '480',
})

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto')
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.resolve(__dirname, '../../database/schema.sql'), 'utf8'))
  const roles = await db.query("insert into roles(name) values ('Admin') returning id")
  const passwordHash = await bcrypt.hash('Review-only-123!', 10)
  const otherRole = await db.query("insert into roles(name) values ('Production Supervisor') returning id")
  for (const username of ['reviewadmin', 'reviewother']) {
    await db.query("insert into users(name,username,email,password_hash,role_id,must_change_password) values ($1,$1,$2,$3,$4,false)", [username, `${username}@example.test`, passwordHash, username === 'reviewadmin' ? roles.rows[0].id : otherRole.rows[0].id])
  }
  for (const migration of ['029_account_onboarding.sql', '030_verify_login_credentials.sql', '031_atomic_login_audit.sql']) {
    await db.exec(fs.readFileSync(path.resolve(__dirname, '../../database/migrations', migration), 'utf8'))
  }
  const client = {
    rpc(name, values) {
      const signatures = {
        issue_refresh_token: ['p_user_id', 'p_token_hash', 'p_expires_at', 'p_verified_hash'],
        rotate_refresh_token: ['p_token_hash', 'p_replacement_token_hash'],
        revoke_refresh_token: ['p_token_hash'],
      }
      if (!signatures[name]) throw new Error('Unsupported test RPC')
      const parameters = signatures[name].map((key) => values[key])
      const result = db.query(`select * from ${name}(${parameters.map((_, index) => `$${index + 1}`).join(',')})`, parameters)
        .then(({ rows }) => ({ data: name === 'rotate_refresh_token' ? rows[0] : rows[0]?.[name], error: null }))
        .catch((error) => { console.error('Disposable database RPC failed:', error.message); return { data: null, error } })
      result.single = () => result
      return result
    },
    from(table) {
      if (table !== 'users') throw new Error('Unsupported test table')
      let field
      let value
      let update
      const query = {
        select() { return query },
        eq(nextField, nextValue) { field = nextField; value = nextValue; return query },
        update(values) { update = values; return query },
        abortSignal() { return query },
        async maybeSingle() {
          if (!['id', 'username'].includes(field)) throw new Error('Unsupported test filter')
          const { rows } = await db.query(`select account.*, jsonb_build_object('name',role.name) as roles from users account join roles role on role.id=account.role_id where account.${field}=$1`, [value])
          return { data: rows[0] || null, error: null }
        },
        then(resolve, reject) {
          return db.query('update users set last_login_at=$1 where id=$2', [update.last_login_at, value])
            .then(() => ({ error: null })).then(resolve, reject)
        },
      }
      return query
    },
  }
  const clientPath = require.resolve('../../src/database/client')
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { getSupabaseClient: () => client } }
  const auditPath = require.resolve('../../src/modules/audit/audit.service')
  require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true, exports: { recordAuditLog: async () => {} } }
  const app = express()
  app.use(cors({ origin: 'http://localhost:5175', credentials: true }))
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/auth', require('../../src/modules/auth/auth.routes'))
  app.use(require('../../src/middleware/errorHandler'))
  const server = app.listen(3005, '127.0.0.1', () => console.log('Disposable auth API ready at http://localhost:3005; no external database access.'))
  async function stop() {
    server.closeAllConnections()
    server.close()
    await db.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
