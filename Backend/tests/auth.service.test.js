const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const authServicePath = path.join(backendRoot, 'src', 'modules', 'auth', 'auth.service.js')
const databaseClientPath = path.join(backendRoot, 'src', 'database', 'client.js')

function loadAuthServiceWithQuery(result, sessionResult = { data: { id: 'session' }, error: null }) {
  const calls = { abortSignal: [], select: [] }
  const query = {
    abortSignal(signal) {
      calls.abortSignal.push(signal)
      return this
    },
    eq() {
      return this
    },
    is() { return this },
    gt() { return this },
    maybeSingle: async () => result,
    select(columns) {
      calls.select.push(columns)
      return this
    },
  }
  const supabase = {
    from(table) {
      assert.ok(['users', 'auth_sessions'].includes(table))
      return table === 'users' ? query : { ...query, maybeSingle: async () => sessionResult }
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
})

test('login lookup still selects the password hash needed by bcrypt', async () => {
  const { authService, calls } = loadAuthServiceWithQuery({ data: activeUser, error: null })

  await authService.findUserByUsername('Admin')

  assert.equal(calls.select.length, 1)
  assert.equal(calls.select[0].includes('password_hash'), true)
})

test('legacy sid-less access tokens cannot bypass session revocation', async () => {
  const { authService } = loadAuthServiceWithQuery({ data: activeUser, error: null })
  await assert.rejects(authService.getAuthenticatedUser({ sub: activeUser.id }), (error) => error.status === 401)
})

test('revoked session rejects an otherwise active account', async () => {
  const { authService } = loadAuthServiceWithQuery({ data: activeUser, error: null }, { data: null, error: null })
  await assert.rejects(authService.getAuthenticatedUser({ sub: activeUser.id, sid: '11111111-1111-4111-8111-111111111111' }), (error) => error.status === 401)
})
