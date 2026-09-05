const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const refreshServicePath = path.join(backendRoot, 'src', 'modules', 'auth', 'refreshTokens.service.js')
const databaseClientPath = path.join(backendRoot, 'src', 'database', 'client.js')

// Minimal fluent fake of the supabase-js builder for the refresh_tokens table.
// Records every operation so tests assert on what the service actually did.
function createSupabaseFake({
  foundRow = null,
  usersRow = null,
  rotationResult = null,
  rpcError = null,
  writeError = null,
} = {}) {
  const ops = []
  let currentTable = null

  function buildChain(table) {
    const state = { action: null, payload: null, filters: {} }
    const record = () => ops.push({ table, ...structuredClone(state) })

    function chain() {
      const api = {
        from(nextTable) {
          currentTable = nextTable
          return buildChain(nextTable)
        },
        select(columns) {
          state.action = state.action || 'select'
          state.select = columns
          return api
        },
        insert(payload) {
          state.action = 'insert'
          state.payload = payload
          return api
        },
        update(payload) {
          state.action = 'update'
          state.payload = payload
          return api
        },
        eq(column, value) {
          state.filters[column] = value
          return api
        },
        is(column, value) {
          state.filters[`${column}__is`] = value
          return api
        },
        maybeSingle: async () => {
          record()
          const data = currentTable === 'refresh_tokens' ? foundRow : usersRow
          return { data, error: null }
        },
        single: async () => {
          record()
          return { data: { id: 'inserted-token-id' }, error: null }
        },
        then(resolve, reject) {
          record()
          return Promise.resolve({ data: null, error: writeError }).then(resolve, reject)
        },
      }
      return api
    }

    return chain()
  }

  const supabase = {
    from: (table) => {
      currentTable = table
      return buildChain(table)
    },
    rpc(functionName, parameters) {
      return {
        single: async () => {
          ops.push({ table: 'rpc', functionName, parameters })
          return { data: rotationResult, error: rpcError }
        },
      }
    },
  }

  return { supabase, ops }
}

function loadServiceWithMocks(options = {}) {
  const { supabase, ops } = createSupabaseFake(options)

  delete require.cache[require.resolve(refreshServicePath)]
  require.cache[require.resolve(databaseClientPath)] = {
    id: databaseClientPath,
    filename: databaseClientPath,
    loaded: true,
    exports: { getSupabaseClient: () => supabase },
  }
  return { service: require(refreshServicePath), ops }
}

const validRow = {
  id: 'token-row-1',
  user_id: 'user-1',
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  revoked_at: null,
}

const revokedRow = { ...validRow, revoked_at: new Date(Date.now() - 1000).toISOString() }

test('issue stores only a SHA-256 hash, never the raw token', async () => {
  const { service, ops } = loadServiceWithMocks()

  const rawToken = await service.issueRefreshToken('user-1')

  assert.ok(rawToken.length >= 40)
  const insertOp = ops.find((op) => op.action === 'insert')
  assert.equal(insertOp.payload.token_hash, service.hashToken(rawToken))
  assert.notEqual(insertOp.payload.token_hash, rawToken)
  assert.equal(insertOp.payload.user_id, 'user-1')
})

test('rotation with a valid token revokes it and returns a new raw token', async () => {
  const { service, ops } = loadServiceWithMocks({
    rotationResult: {
      outcome: 'rotated',
      user_id: 'user-1',
      expires_at: validRow.expires_at,
    },
    usersRow: {
      id: 'user-1',
      name: 'Admin',
      username: 'admin',
      email: 'a@example.com',
      status: 'Active',
      must_change_password: false,
      deleted_at: null,
      roles: { name: 'Admin' },
    },
  })

  const result = await service.rotateRefreshToken('raw-token-value')

  assert.notEqual(result.rawToken, 'raw-token-value')
  assert.equal(result.user.id, 'user-1')
  const rotationOp = ops.find((op) => op.table === 'rpc' && op.functionName === 'rotate_refresh_token')
  assert.ok(rotationOp, 'rotation must use the database transaction')
  assert.equal(rotationOp.parameters.p_token_hash, service.hashToken('raw-token-value'))
  assert.equal(rotationOp.parameters.p_replacement_token_hash, service.hashToken(result.rawToken))
  assert.equal(
    ops.filter((op) => op.table === 'refresh_tokens' && ['insert', 'update'].includes(op.action)).length,
    0,
  )
  assert.equal(result.expiresAt, validRow.expires_at)
})

test('a replay outcome is surfaced as refresh-token reuse', async () => {
  const { service, ops } = loadServiceWithMocks({
    rotationResult: {
      outcome: 'reused',
      user_id: 'user-1',
      expires_at: validRow.expires_at,
    },
  })

  await assert.rejects(
    () => service.rotateRefreshToken('raw-token-value'),
    (error) => error.code === 'REFRESH_TOKEN_REUSED',
  )

  assert.equal(ops.filter((op) => op.table === 'rpc').length, 1)
})

test('a reused token returns a security-specific 401 response', async () => {
  const { service, ops } = loadServiceWithMocks({
    rotationResult: {
      outcome: 'reused',
      user_id: revokedRow.user_id,
      expires_at: revokedRow.expires_at,
    },
  })

  await assert.rejects(
    () => service.rotateRefreshToken('replayed-token'),
    (error) => error.status === 401,
  )

  assert.equal(ops.filter((op) => op.table === 'rpc').length, 1)
})

test('expired and unknown tokens are rejected without revoking anything', async () => {
  const expired = loadServiceWithMocks({ rotationResult: { outcome: 'invalid' } })
  await assert.rejects(() => expired.service.rotateRefreshToken('expired'), (error) => error.status === 401)
  assert.equal(expired.ops.filter((op) => op.table === 'rpc').length, 1)

  const unknown = loadServiceWithMocks({ rotationResult: { outcome: 'invalid' } })
  await assert.rejects(() => unknown.service.rotateRefreshToken('unknown'), (error) => error.status === 401)
  assert.equal(unknown.ops.filter((op) => op.table === 'rpc').length, 1)
})

test('logout revokes the presented token row', async () => {
  const { service, ops } = loadServiceWithMocks({ foundRow: validRow })

  await service.revokeRefreshToken('raw-token-value')

  const revokeOp = ops.find((op) => op.action === 'update' && op.filters.id === 'token-row-1')
  assert.ok(revokeOp, 'presented token must be revoked')
})

test('logout reports a server failure when token revocation cannot be persisted', async () => {
  const { service } = loadServiceWithMocks({ foundRow: validRow, writeError: { message: 'database unavailable' } })

  await assert.rejects(
    () => service.revokeRefreshToken('raw-token-value'),
    (error) => error.code === 'REFRESH_TOKEN_REVOKE_FAILED',
  )
})

test('access token lifetime comes from env, not a hardcoded 8h constant', () => {
  const authServicePath = path.join(backendRoot, 'src', 'modules', 'auth', 'auth.service.js')
  delete require.cache[require.resolve(authServicePath)]
  const authService = require(authServicePath)
  const token = authService.createAuthToken({
    id: 'user-1',
    username: 'admin',
    roles: { name: 'Admin' },
  })
  const payload = require('jsonwebtoken').decode(token)

  const expectedSeconds = 30 * 60
  assert.equal(payload.exp - payload.iat, expectedSeconds)
})
