const assert = require('node:assert/strict')
const path = require('node:path')

const backendRoot = path.resolve(__dirname, '..', '..')

process.env.NODE_ENV = 'test'
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'

function clearBackendCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) {
      delete require.cache[cacheKey]
    }
  })
}

function mockModule(relativePath, exportsValue) {
  const modulePath = path.join(backendRoot, relativePath)
  require.cache[require.resolve(modulePath)] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  }
}

function loadAppWithMocks(mocks = {}) {
  clearBackendCache()

  if (!mocks['src/modules/auth/auth.service.js']) {
    mockModule('src/modules/auth/auth.service.js', {
      login: async () => ({}),
      createAuthToken: () => 'test-access-token',
      getAuthenticatedUser: async (tokenPayload) => ({
        id: tokenPayload.sub,
        name: tokenPayload.username,
        username: tokenPayload.username,
        role: tokenPayload.role,
        mustChangePassword: false,
      }),
    })
  }

  if (!mocks['src/modules/auth/refreshTokens.service.js']) {
    mockModule('src/modules/auth/refreshTokens.service.js', {
      issueRefreshToken: async () => ({ rawToken: 'test-refresh-token', sessionId: 'test-session' }),
      revokeRefreshToken: async () => {},
      revokeAllForUser: async () => {},
      rotateRefreshToken: async () => ({
        rawToken: 'test-rotated-token',
        user: { id: 'user-1', username: 'admin', name: 'Admin', role: 'Admin' },
      }),
    })
  }

  Object.entries(mocks).forEach(([relativePath, exportsValue]) => {
    mockModule(relativePath, exportsValue)
  })

  return require(path.join(backendRoot, 'src', 'app'))
}

async function withTestServer(app, testFn) {
  const server = app.listen(0)

  await new Promise((resolve) => {
    server.once('listening', resolve)
  })

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    return await testFn(baseUrl)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

async function readJson(response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  })

  return {
    response,
    body: await readJson(response),
  }
}

function assertError(body, code) {
  assert.equal(body?.error?.code, code)
}

module.exports = {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
}
