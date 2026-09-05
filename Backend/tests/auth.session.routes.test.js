const assert = require('node:assert/strict')
const test = require('node:test')

const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('./helpers/appTestUtils')

const REFRESH_COOKIE = 'ph_refresh'

function parseCookies(response) {
  const raw = response.headers.get('set-cookie') || ''
  return raw.split(/,(?=[^;]+=)/)
}

function findRefreshCookie(response) {
  return parseCookies(response).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))
}

function mockRefreshService(overrides = {}) {
  return {
    issueRefreshToken: async () => 'issued-raw-token',
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
      headers: { Cookie: `${REFRESH_COOKIE}=previous-raw-token` },
      body: { username: 'admin', password: 'whatever' },
    })

    assert.equal(response.status, 200)
    assert.equal(revokedToken, 'previous-raw-token')
  })
})

test('refresh with a valid cookie returns a new access token and rotates the cookie', async () => {
  const app = loadAuthApp()

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=raw-token-value` },
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
      headers: { Cookie: `${REFRESH_COOKIE}=replayed` },
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
        Cookie: `${REFRESH_COOKIE}=raw-token-value`,
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
        headers: { Cookie: `${REFRESH_COOKIE}=raw-token-value` },
      })
      assert.equal(response.status, 200)
    }

    const { response, body } = await requestJson(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=raw-token-value` },
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
      headers: { Cookie: `${REFRESH_COOKIE}=raw-token-value` },
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
      headers: { Cookie: `${REFRESH_COOKIE}=raw-token-value` },
    })

    assert.equal(response.status, 500)
    assertError(body, 'REFRESH_TOKEN_REVOKE_FAILED')
    assert.match(findRefreshCookie(response), /Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })
})
