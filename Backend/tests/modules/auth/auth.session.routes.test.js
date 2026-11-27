const assert = require('node:assert/strict')
const test = require('node:test')

const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('../../helpers/appTestUtils')

const REFRESH_COOKIE = 'ph_refresh'
const VALID_REFRESH_TOKEN = 'a'.repeat(43)
const PREVIOUS_REFRESH_TOKEN = 'b'.repeat(43)
const REPLAYED_REFRESH_TOKEN = 'c'.repeat(43)

function parseCookies(response) {
  const raw = response.headers.get('set-cookie') || ''
  return raw.split(/,(?=[^;]+=)/)
}

function findRefreshCookie(response) {
  return parseCookies(response).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))
}

function mockRefreshService(overrides = {}) {
  return {
    issueRefreshToken: async () => ({ rawToken: 'issued-raw-token', sessionId: 'session-1' }),
    revokeRefreshToken: async () => {},
    revokeAllForUser: async () => {},
    rotateRefreshToken: async () => ({
      rawToken: 'rotated-raw-token',
      user: { id: 'user-1', name: 'Admin', username: 'admin', role: 'Admin' },
    }),
    ...overrides,
  }
}

function loadAuthApp({ authServiceOverrides = {}, refreshServiceOverrides = {} } = {}) {
  return loadAppWithMocks({
    'src/modules/auth/auth.service.js': {
      login: async () => ({
        token: 'access-jwt',
        user: { id: 'user-1', name: 'Admin', username: 'admin', role: 'Admin' },
      }),
      getAuthenticatedUser: async (tokenPayload) => ({ id: tokenPayload.sub, role: 'Admin' }),
      createAuthToken: () => 'refreshed-access-jwt',
      ...authServiceOverrides,
    },
    'src/modules/auth/refreshTokens.service.js': mockRefreshService(refreshServiceOverrides),
  })
}

test('login sets a hardened refresh cookie alongside the access token', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response } = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'whatever' },
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const cookie = findRefreshCookie(response)
    assert.ok(cookie, 'refresh cookie must be set')
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Strict/i)
    assert.match(cookie, /Path=\/api\/auth(?:;|$)/i)
  })
})

test('login revokes a prior browser refresh token before replacing the cookie', async () => {
  let revokedToken = null
  const app = loadAuthApp({
    refreshServiceOverrides: {
      revokeRefreshToken: async (rawToken) => {
        revokedToken = rawToken
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const { response } = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${PREVIOUS_REFRESH_TOKEN}` },
      body: { username: 'admin', password: 'whatever' },
    })

    assert.equal(response.status, 200)
    assert.equal(revokedToken, PREVIOUS_REFRESH_TOKEN)
  })
})

test('refresh with a valid cookie returns a new access token and rotates the cookie', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${VALID_REFRESH_TOKEN}` },
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(body.token)
    assert.ok(body.user)
    const cookie = findRefreshCookie(response)
    assert.ok(cookie.includes('rotated-raw-token'), 'cookie must carry the rotated token')
  })
})

test('refresh without a cookie is a generic 401', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/auth/refresh', { method: 'POST' })

    assert.equal(response.status, 401)
    assertError(body, 'UNAUTHENTICATED')
  })
})

test('refresh treats a malformed cookie as absent instead of throwing', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=%E0%A4%A` },
    })

    assert.equal(response.status, 401)
    assertError(body, 'UNAUTHENTICATED')
  })
})

test('refresh with an unknown or reused token is a 401 and clears the cookie', async () => {
  const app = loadAuthApp({
    refreshServiceOverrides: {
      rotateRefreshToken: async () => {
        const error = new Error('session invalid')
        error.status = 401
        throw error
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const { response } = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${REPLAYED_REFRESH_TOKEN}` },
    })

    assert.equal(response.status, 401)
    const cookie = findRefreshCookie(response)
    assert.ok(cookie, 'cookie must be cleared')
    assert.match(cookie, /Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })
})

test('refresh from a disallowed origin is rejected by the CSRF origin check', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response } = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: {
        Cookie: `${REFRESH_COOKIE}=${VALID_REFRESH_TOKEN}`,
        Origin: 'https://evil.example.com',
      },
    })

    assert.equal(response.status, 403)
  })
})

test('refresh is rate-limited before repeated rotations reach the controller', async () => {
  let rotations = 0
  const app = loadAuthApp({
    refreshServiceOverrides: {
      rotateRefreshToken: async () => {
        rotations += 1
        return {
          rawToken: 'rotated-raw-token',
          user: { id: 'user-1', name: 'Admin', username: 'admin', role: 'Admin' },
        }
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { response } = await requestJson(baseUrl, '/api/auth/refresh', {
        method: 'POST',
        headers: { Cookie: `${REFRESH_COOKIE}=${VALID_REFRESH_TOKEN}` },
      })
      assert.equal(response.status, 200)
    }

    const { response, body } = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${VALID_REFRESH_TOKEN}` },
    })
    assert.equal(response.status, 429)
    assertError(body, 'RATE_LIMITED')
  })

  assert.equal(rotations, 20)
})

test('logout revokes the presented refresh token and clears the cookie', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response } = await requestJson(baseUrl, '/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${VALID_REFRESH_TOKEN}` },
    })

    assert.equal(response.status, 200)
    const cookie = findRefreshCookie(response)
    assert.ok(cookie)
    assert.match(cookie, /Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })
})

test('logout with no cookie still succeeds', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response } = await requestJson(baseUrl, '/api/auth/logout', { method: 'POST' })
    assert.equal(response.status, 200)
  })
})

test('logout never reports success when refresh-token revocation fails', async () => {
  const app = loadAuthApp({
    refreshServiceOverrides: {
      revokeRefreshToken: async () => {
        const error = new Error('database unavailable')
        error.status = 500
        error.code = 'REFRESH_TOKEN_REVOKE_FAILED'
        throw error
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${VALID_REFRESH_TOKEN}` },
    })

    assert.equal(response.status, 500)
    assertError(body, 'REFRESH_TOKEN_REVOKE_FAILED')
    assert.match(findRefreshCookie(response), /Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })
})

test('login rejects oversized username/password and unexpected fields', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const longUser = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'u'.repeat(81), password: 'Password1!' },
    })
    assert.equal(longUser.response.status, 400)

    const longPass = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'p'.repeat(73) },
    })
    assert.equal(longPass.response.status, 400)

    const extraField = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'Password1!', role: 'Admin' },
    })
    assert.equal(extraField.response.status, 400)
  })
})

test('logout ignores malformed refresh cookies without calling revokeRefreshToken and is rate-limited', async () => {
  let revokeCalls = 0
  const app = loadAuthApp({
    refreshServiceOverrides: {
      revokeRefreshToken: async () => { revokeCalls += 1 },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const badCookie = await requestJson(baseUrl, '/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=arbitrary-invalid-string` },
    })
    assert.equal(badCookie.response.status, 200)
    assert.equal(revokeCalls, 0)

    for (let attempt = 1; attempt < 20; attempt += 1) {
      const { response } = await requestJson(baseUrl, '/api/auth/logout', { method: 'POST' })
      assert.equal(response.status, 200)
    }
    const limited = await requestJson(baseUrl, '/api/auth/logout', { method: 'POST' })
    assert.equal(limited.response.status, 429)
    assertError(limited.body, 'RATE_LIMITED')
  })
})

test('login runs dummy bcrypt comparison for missing or ineligible accounts', async () => {
  const bcrypt = require('bcryptjs')
  const originalCompare = bcrypt.compare
  let compareCalls = 0
  bcrypt.compare = async (...args) => {
    compareCalls += 1
    return originalCompare(...args)
  }

  try {
    const clientPath = require.resolve('../../../src/database/client')
    const servicePath = require.resolve('../../../src/modules/auth/auth.service')
    delete require.cache[servicePath]
    require.cache[clientPath] = {
      id: clientPath,
      filename: clientPath,
      loaded: true,
      exports: {
        getSupabaseClient: () => ({
          from(table) {
            if (table === 'users') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
            }
            return { insert: async () => ({ error: null }) }
          },
        }),
      },
    }
    const authService = require('../../../src/modules/auth/auth.service')
    await assert.rejects(authService.login({ username: 'nobody', password: 'WrongPassword1!' }), { status: 401 })
    assert.equal(compareCalls, 1)
  } finally {
    bcrypt.compare = originalCompare
  }
})
