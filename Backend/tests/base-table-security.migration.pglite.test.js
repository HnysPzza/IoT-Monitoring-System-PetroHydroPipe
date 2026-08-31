const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '016_protect_base_tables.sql'),
  'utf8',
)

const baseTables = [
  'roles',
  'users',
  'machines',
  'sensors',
  'sensor_events',
  'downtime_events',
  'production_counts',
  'audit_logs',
  'alerts',
]

const servicePrivileges = {
  roles: ['SELECT'],
  users: ['SELECT', 'INSERT', 'UPDATE'],
  machines: ['SELECT', 'UPDATE'],
  sensors: ['SELECT', 'UPDATE'],
  sensor_events: ['SELECT'],
  downtime_events: ['SELECT'],
  production_counts: ['SELECT'],
  audit_logs: ['SELECT', 'INSERT'],
  alerts: ['SELECT'],
}

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  return db
}

async function createLegacyTables(db) {
  await db.exec(baseTables
    .map((table) => `create table public.${table} (id integer primary key, value text);`)
    .join('\n'))
}

async function readSecurityState(db) {
  const { rows } = await db.query(`
    select
      table_name,
      relrowsecurity,
      has_table_privilege('public', format('public.%I', table_name), 'SELECT') as public_select,
      has_table_privilege('anon', format('public.%I', table_name), 'SELECT') as anon_select,
      has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') as authenticated_select
    from unnest($1::text[]) as requested(table_name)
    join pg_class relation on relation.oid = to_regclass(format('public.%I', table_name))
    order by table_name
  `, [baseTables])
  return rows
}

async function assertServicePrivileges(db) {
  for (const table of baseTables) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const { rows } = await db.query(
        'select has_table_privilege($1, $2, $3) as allowed',
        ['service_role', `public.${table}`, privilege],
      )
      assert.equal(
        rows[0].allowed,
        servicePrivileges[table].includes(privilege),
        `${table} ${privilege}`,
      )
    }
  }
}

function assertClientRolesDenied(rows) {
  assert.equal(rows.length, baseTables.length)
  rows.forEach((row) => {
    assert.equal(row.relrowsecurity, true, `${row.table_name} RLS`)
    assert.equal(row.public_select, false, `${row.table_name} public SELECT`)
    assert.equal(row.anon_select, false, `${row.table_name} anon SELECT`)
    assert.equal(row.authenticated_select, false, `${row.table_name} authenticated SELECT`)
  })
}

test('migration 016 protects every base table and is safe to reapply', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyTables(db)

  await db.exec(migrationSql)
  await db.exec(migrationSql)

  assertClientRolesDenied(await readSecurityState(db))
  await assertServicePrivileges(db)
})

test('migration 016 fails closed when a required base table is missing', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await createLegacyTables(db)
  await db.exec('drop table public.alerts;')

  await assert.rejects(db.exec(migrationSql), /Required base table public\.alerts is missing/)
  await db.exec('rollback;')

  const { rows } = await db.query(`
    select relrowsecurity
    from pg_class
    where oid = 'public.roles'::regclass
  `)
  assert.equal(rows[0].relrowsecurity, false)
})

test('fresh schema mirrors migration 016 base-table protection', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())
  await db.exec(schemaSql)

  assertClientRolesDenied(await readSecurityState(db))
  await assertServicePrivileges(db)
})
