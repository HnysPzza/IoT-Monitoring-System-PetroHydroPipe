const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '../../..')
const authServicePath = path.join(backendRoot, 'src', 'modules', 'auth', 'auth.service.js')
const databaseClientPath = path.join(backendRoot, 'src', 'database', 'client.js')

function loadAuthServiceWithQuery(result, sessionResult = { data: { id: 'session' }, error: null }) {
  const calls = { abortSignal: [], select: [], filters: [] }
  const query = {
    abortSignal(signal) {
      calls.abortSignal.push(signal)
      return this
    },
    eq(column, value) {
      calls.filters.push([column, value])
      return this
    },
    is(column, value) { calls.filters.push([column, value]); return this },
    gt(column, value) { calls.filters.push([column, value]); return this },
    maybeSingle: async () => result,
    select(columns) {
      calls.select.push(columns)
      return this
    },
  }
  const supabase = {
    from(table) {
      assert.ok(['users', 'auth_sessions'].includes(table))
      return table === 'users' ? query : { ...query, maybeSingle: async () => typeof sessionResult === 'function' ? sessionResult() : sessionResult }
    },
  }

  delete require.cache[require.resolve(authServicePath)]
  require.cache[require.resolve(databaseClientPath)] = {
    id: databaseClientPath,
    filename: databaseClientPath,
    loaded: true,
    exports: { getSupabaseClient: () => supabase },
  }

  return { authService: require(authServicePath), calls }
}

const activeUser = {
  id: 'user-1',
  name: 'Admin',
  username: 'admin',
  email: 'admin@example.com',
  password_hash: 'sensitive-hash',
  status: 'Active',
  must_change_password: false,
  deleted_at: null,
  roles: { name: 'Admin' },
}

test('session revalidation excludes password hashes and forwards cancellation', async () => {
  const { authService, calls } = loadAuthServiceWithQuery({ data: activeUser, error: null })
  const controller = new AbortController()

  const user = await authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' }, { signal: controller.signal })

  assert.equal(user.role, 'Admin')
  assert.equal(calls.select.length, 2)
  assert.equal(calls.select[0].includes('password_hash'), false)
  assert.deepEqual(calls.abortSignal, [controller.signal, controller.signal])
  assert.ok(calls.filters.some(([column, value]) => column === 'user_id' && value === activeUser.id))
  assert.ok(calls.filters.some(([column, value]) => column === 'revoked_at' && value === null))
  assert.ok(calls.filters.some(([column, value]) => column === 'expires_at' && Number.isFinite(Date.parse(value))))
})

test('login lookup still selects the password hash needed by bcrypt', async () => {
  const { authService, calls } = loadAuthServiceWithQuery({ data: activeUser, error: null })

  await authService.findUserByUsername('Admin')

  assert.equal(calls.select.length, 1)
  assert.equal(calls.select[0].includes('password_hash'), true)
})

test('legacy sid-less access tokens cannot bypass session revocation', async () => {
  const { authService } = loadAuthServiceWithQuery({ data: activeUser, error: null })
  await assert.rejects(authService.getAuthenticatedUser({ sub: activeUser.id }), (error) => {
    assert.deepEqual([error.status, error.code, error.message], [401, 'UNAUTHENTICATED', 'Sign in again to start a verified session.'])
    return true
  })
})

test('revoked session rejects an otherwise active account', async () => {
  const { authService } = loadAuthServiceWithQuery({ data: activeUser, error: null }, { data: null, error: null })
  await assert.rejects(authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' }), (error) => error.status === 401)
})

test('checks the session after the user lookup completes', async () => {
  let resolveUser
  const pendingUser = new Promise((resolve) => { resolveUser = resolve })
  const { authService, calls } = loadAuthServiceWithQuery(pendingUser)
  const request = authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' })
  await Promise.resolve()
  assert.equal(calls.select.length, 1)
  resolveUser({ data: activeUser, error: null })
  await request
  assert.equal(calls.select.length, 2)
})

test('rejects a session revoked while the user lookup is pending', async () => {
  let resolveUser
  let revoked = false
  const pendingUser = new Promise((resolve) => { resolveUser = resolve })
  const { authService } = loadAuthServiceWithQuery(pendingUser, () => ({ data: revoked ? null : { id: 'session' }, error: null }))
  const request = authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' })
  revoked = true
  resolveUser({ data: activeUser, error: null })
  await assert.rejects(request, (error) => error.status === 401 && error.code === 'UNAUTHENTICATED')
})

for (const [description, user, session, expected] of [
  ['missing user', null, { data: null, error: null }, [401, 'UNAUTHENTICATED', 'Authenticated user no longer exists.']],
  ['archived user', { ...activeUser, deleted_at: '2026-01-01' }, { data: null, error: null }, [403, 'ACCOUNT_ARCHIVED', 'User account is archived.']],
  ['inactive user', { ...activeUser, status: 'Inactive' }, { data: null, error: null }, [403, 'ACCOUNT_INACTIVE', 'User account is inactive.']],
  ['invited user', { ...activeUser, onboarding_state: 'Invited' }, { data: null, error: null }, [403, 'ACCOUNT_SETUP_REQUIRED', 'Finish account setup before signing in.']],
  ['revoked or expired session', activeUser, { data: null, error: null }, [401, 'UNAUTHENTICATED', 'Session has ended. Sign in again.']],
  ['session lookup failure', activeUser, { data: null, error: {} }, [500, 'AUTH_QUERY_FAILED', 'Unable to verify session.']],
]) {
  test(`denies ${description} with the existing response contract`, async () => {
    const { authService } = loadAuthServiceWithQuery({ data: user, error: null }, session)
    await assert.rejects(authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' }), (error) => {
      assert.deepEqual([error.status, error.code, error.message], expected)
      return true
    })
  })
}

test('denies a failed user lookup even when the session lookup succeeds', async () => {
  const { authService } = loadAuthServiceWithQuery({ data: null, error: {} })
  await assert.rejects(authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' }), (error) => {
    assert.deepEqual([error.status, error.code, error.message], [500, 'AUTH_QUERY_FAILED', 'Unable to load authenticated user.'])
    return true
  })
})

test('preserves inactive-account denial without depending on session lookup', async () => {
  const sessionFailure = Promise.reject(new Error('Session unavailable'))
  sessionFailure.catch(() => {})
  const { authService } = loadAuthServiceWithQuery({ data: { ...activeUser, status: 'Inactive' }, error: null }, sessionFailure)
  await assert.rejects(authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' }), (error) => {
    assert.deepEqual([error.status, error.code, error.message], [403, 'ACCOUNT_INACTIVE', 'User account is inactive.'])
    return true
  })
})

test('does not delay inactive-account denial on a hanging session lookup', async () => {
  const { authService } = loadAuthServiceWithQuery({ data: { ...activeUser, status: 'Inactive' }, error: null }, new Promise(() => {}))
  const result = await Promise.race([
    authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' }).then(() => 'allowed', (error) => error.code),
    new Promise((resolve) => setTimeout(() => resolve('timed out'), 100)),
  ])
  assert.equal(result, 'ACCOUNT_INACTIVE')
})

test('failed-login audit persistence errors are surfaced without leaking database details', async () => {
  const auditPath = require.resolve('../../../src/modules/audit/audit.service')
  delete require.cache[auditPath]
  delete require.cache[require.resolve(authServicePath)]
  require.cache[require.resolve(databaseClientPath)] = {
    id: databaseClientPath, filename: databaseClientPath, loaded: true,
    exports: { getSupabaseClient: () => ({ from: (table) => table === 'users'
      ? { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null, error: null }) }
      : { insert: async () => ({ error: { message: 'sensitive database detail' } }) } }) },
  }
  await assert.rejects(require(authServicePath).login({ username: 'unknown', password: 'wrong' }), (error) => {
    assert.equal(error.status, 503)
    assert.equal(error.message.includes('sensitive'), false)
    return true
  })
})
