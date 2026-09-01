const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const migrationPath = path.join(
  backendRoot,
  'database',
  'migrations',
  '024_add_backend_readiness_check.sql',
)

test('readiness migration is repeatable and restricted to service role', async (t) => {
  assert.equal(fs.existsSync(migrationPath), true, 'migration 024 must exist')

  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8'))

  const migration = fs.readFileSync(migrationPath, 'utf8')
  await db.exec(migration)
  await db.exec(migration)

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role};`)
    await assert.rejects(
      db.query('select public.get_backend_readiness() as schema_version'),
      /permission denied/i,
    )
    await db.exec('reset role;')
  }

  await db.exec('set role service_role;')
  const result = await db.query('select public.get_backend_readiness() as schema_version')
  await db.exec('reset role;')
  assert.equal(result.rows[0].schema_version, 24)
})

test('readiness fails when a critical database dependency is missing', async (t) => {
  assert.equal(fs.existsSync(migrationPath), true, 'migration 024 must exist')

  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(migrationPath, 'utf8'))
  await db.exec('drop function public.get_machine_live_snapshot(text); set role service_role;')

  await assert.rejects(
    db.query('select public.get_backend_readiness() as schema_version'),
    /required database dependencies are missing/i,
  )
})
