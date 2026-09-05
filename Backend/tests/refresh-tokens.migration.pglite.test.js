const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const schemaSql = fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '026_refresh_tokens.sql'),
  'utf8',
)

async function createDatabase() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  return db
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
  `, [['refresh_tokens']])
  return rows
}

async function assertServicePrivileges(db) {
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const { rows } = await db.query(
      'select has_table_privilege($1, $2, $3) as allowed',
      ['service_role', 'public.refresh_tokens', privilege],
    )
    assert.equal(rows[0].allowed, ['SELECT', 'INSERT', 'UPDATE'].includes(privilege), privilege)
  }
}

async function assertRotationFunctionPrivileges(db) {
  const { rows } = await db.query(`
    select
      prosecdef,
      has_function_privilege('service_role', oid, 'EXECUTE') as service_execute,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_execute
    from pg_proc
    where oid = 'public.rotate_refresh_token(text,text)'::regprocedure
  `)

  assert.deepEqual(rows, [{
    prosecdef: false,
    service_execute: true,
    anon_execute: false,
    authenticated_execute: false,
  }])
}

test('migration 026 creates refresh_tokens with service-role-only access and is safe to reapply', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  await db.exec(schemaSql)
  await db.exec(migrationSql)
  await db.exec(migrationSql)

  const rows = await readSecurityState(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].relrowsecurity, true, 'RLS')
  assert.equal(rows[0].public_select, false, 'public SELECT')
  assert.equal(rows[0].anon_select, false, 'anon SELECT')
  assert.equal(rows[0].authenticated_select, false, 'authenticated SELECT')
  await assertServicePrivileges(db)
  await assertRotationFunctionPrivileges(db)
})

test('refresh token rows cascade away with their user', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  await db.exec(schemaSql)
  await db.exec(migrationSql)

  const { rows: roles } = await db.query(`
    insert into public.roles (name) values ('Admin')
    returning id
  `)
  const { rows: created } = await db.query(`
    insert into public.users (name, username, email, password_hash, status, role_id)
    values ('Test', 'test-user', 'test@example.com', 'hash', 'Active', $1)
    returning id
  `, [roles[0].id])
  await db.query(
    `insert into public.refresh_tokens (user_id, token_hash, expires_at)
     values ($1, 'hash-a', now() + interval '8 hours')`,
    [created[0].id],
  )
  await db.query('delete from public.users where id = $1', [created[0].id])

  const { rows: remaining } = await db.query('select * from public.refresh_tokens')
  assert.equal(remaining.length, 0)
})

test('rotation RPC atomically replaces a token and revokes all sessions on replay', async (t) => {
  const db = await createDatabase()
  t.after(() => db.close())

  await db.exec(schemaSql)
  await db.exec(migrationSql)

  const { rows: roles } = await db.query(`
    insert into public.roles (name) values ('Admin')
    returning id
  `)
  const { rows: created } = await db.query(`
    insert into public.users (name, username, email, password_hash, status, role_id)
    values ('Test', 'refresh-user', 'refresh@example.com', 'hash', 'Active', $1)
    returning id
  `, [roles[0].id])
  await db.query(
    `insert into public.refresh_tokens (user_id, token_hash, expires_at)
     values ($1, repeat('a', 64), now() + interval '8 hours')`,
    [created[0].id],
  )

  await db.exec('set role service_role;')
  const rotated = await db.query(`
    select * from public.rotate_refresh_token(repeat('a', 64), repeat('b', 64))
  `)
  assert.equal(rotated.rows[0].outcome, 'rotated')
  assert.equal(rotated.rows[0].user_id, created[0].id)

  const { rows: tokenRows } = await db.query(`
    select token_hash, revoked_at is null as active
    from public.refresh_tokens
    where user_id = $1
    order by token_hash
  `, [created[0].id])
  assert.deepEqual(tokenRows, [
    { token_hash: 'a'.repeat(64), active: false },
    { token_hash: 'b'.repeat(64), active: true },
  ])

  const replay = await db.query(`
    select * from public.rotate_refresh_token(repeat('a', 64), repeat('c', 64))
  `)
  assert.equal(replay.rows[0].outcome, 'reused')

  const { rows: activeTokens } = await db.query(`
    select count(*)::int as count
    from public.refresh_tokens
    where user_id = $1 and revoked_at is null
  `, [created[0].id])
  assert.equal(activeTokens[0].count, 0)

  const { rows: auditRows } = await db.query(`
    select action
    from public.audit_logs
    where user_id = $1 and action = 'REFRESH_TOKEN_REUSED'
  `, [created[0].id])
  assert.equal(auditRows.length, 1)
  await db.exec('reset role; set role authenticated;')
  await assert.rejects(
    db.query(`select * from public.rotate_refresh_token(repeat('a', 64), repeat('d', 64))`),
    /permission denied/i,
  )
})
