const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '021_add_managing_director_role.sql'),
  'utf8',
)
const seedSql = fs.readFileSync(path.join(backendRoot, 'database', 'seed.sql'), 'utf8')

test('migration 021 adds the Managing Director role and is safe to reapply', async (t) => {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(schemaSql)
  await db.exec(migrationSql)
  await db.exec(migrationSql)

  const result = await db.query(
    `select name, description from public.roles where name = 'Managing Director'`,
  )

  assert.deepEqual(result.rows, [{
    name: 'Managing Director',
    description: 'Full read access to operational analytics and reports.',
  }])
  assert.match(seedSql, /'Managing Director', 'Full read access to operational analytics and reports\.'/)
})
