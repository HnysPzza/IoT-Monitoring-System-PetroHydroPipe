const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

test('public setup failures do not consume authenticated password-change allowance', async () => {
  const app = loadAppWithMocks({
    'src/modules/auth/onboarding.service.js': { changePassword: async () => {} },
  })
  const headers = { Authorization: `Bearer ${jwt.sign({ role: 'Admin' }, process.env.JWT_SECRET, { subject: '11111111-1111-4111-8111-111111111111' })}` }
  await withTestServer(app, async (baseUrl) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await requestJson(baseUrl, '/api/auth/setup-password', { method: 'POST', body: {} })
    }
    const response = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old', password: 'New-password1!' }),
    })
    assert.equal(response.status, 200)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await fetch(`${baseUrl}/api/auth/change-password`, { method: 'POST', headers, body: '{}' })
    }
    const limited = await fetch(`${baseUrl}/api/auth/change-password`, { method: 'POST', headers })
    assert.equal(limited.status, 429)
    const otherHeaders = { Authorization: `Bearer ${jwt.sign({ role: 'Admin' }, process.env.JWT_SECRET, { subject: '22222222-2222-4222-8222-222222222222' })}` }
    const other = await requestJson(baseUrl, '/api/auth/change-password', { method: 'POST', headers: otherHeaders, body: { currentPassword: 'old', password: 'New-password1!' } })
    assert.equal(other.response.status, 200)
  })
})

test('setup link validation is private, validates input, and does not consume the token', async () => {
  const calls = []
  const app = loadAppWithMocks({
    'src/modules/auth/onboarding.service.js': { validateSetupToken: async (body) => { calls.push(body); return { validForMs: 60000 } } },
  })
  await withTestServer(app, async (baseUrl) => {
    const body = { token: 'a'.repeat(64) }
    const invalid = await requestJson(baseUrl, '/api/auth/setup-password/validate', { method: 'POST', body: { token: 'bad' } })
    assert.equal(invalid.response.status, 400)
    const foreign = await requestJson(baseUrl, '/api/auth/setup-password/validate', { method: 'POST', body, headers: { Origin: 'https://foreign.example' } })
    assert.equal(foreign.response.status, 403)
    const success = await requestJson(baseUrl, '/api/auth/setup-password/validate', { method: 'POST', body })
    assert.equal(success.response.status, 200)
    assert.equal(success.response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(success.body, { validForMs: 60000 })
    assert.deepEqual(calls, [body])
  })
})

test('setup validates input, rejects foreign origins, and requires no login', async () => {
  const calls = []
  const app = loadAppWithMocks({
    'src/modules/auth/onboarding.service.js': { setupPassword: async (body) => calls.push(body) },
  })
  await withTestServer(app, async (baseUrl) => {
    const body = { token: 'a'.repeat(64), password: 'A-long-new-password1!' }
    const invalid = await requestJson(baseUrl, '/api/auth/setup-password', { method: 'POST', body: { ...body, token: 'bad' } })
    assert.equal(invalid.response.status, 400)
    const foreign = await requestJson(baseUrl, '/api/auth/setup-password', { method: 'POST', body, headers: { Origin: 'https://foreign.example' } })
    assert.equal(foreign.response.status, 403)
    const success = await requestJson(baseUrl, '/api/auth/setup-password', { method: 'POST', body })
    assert.equal(success.response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(success.body.completed, true)
    assert.equal(JSON.stringify(success.body).includes(body.token), false)
  })
})

test('rechecking a link cannot exhaust the password submission allowance', async () => {
  const app = loadAppWithMocks({
    'src/modules/auth/onboarding.service.js': {
      validateSetupToken: async () => ({ validForMs: 60000 }),
      setupPassword: async () => {},
    },
  })
  await withTestServer(app, async (baseUrl) => {
    const token = 'a'.repeat(64)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await requestJson(baseUrl, '/api/auth/setup-password/validate', { method: 'POST', body: { token } })
    }
    const result = await fetch(`${baseUrl}/api/auth/setup-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: 'A-long-new-password1!' }) })
    assert.equal(result.status, 200)
    assert.equal((await result.json()).completed, true)
  })
})

test('temporary-password sessions can change password but cannot use business endpoints', async () => {
  let changed = false
  const userId = '11111111-1111-4111-8111-111111111111'
  const app = loadAppWithMocks({
    'src/modules/auth/auth.service.js': { getAuthenticatedUser: async () => ({ id: userId, role: 'Admin', mustChangePassword: true }) },
    'src/modules/auth/onboarding.service.js': { changePassword: async () => { changed = true } },
  })
  const headers = { Authorization: `Bearer ${jwt.sign({}, process.env.JWT_SECRET, { subject: userId })}` }
  await withTestServer(app, async (baseUrl) => {
    const denied = await requestJson(baseUrl, '/api/users', { headers })
    assert.equal(denied.response.status, 403)
    assert.equal(denied.body.error.code, 'PASSWORD_CHANGE_REQUIRED')
    const allowed = await requestJson(baseUrl, '/api/auth/change-password', { method: 'POST', headers, body: { currentPassword: 'temporary', password: 'My-new-long-password1!' } })
    assert.equal(allowed.response.status, 200)
    assert.equal(changed, true)
  })
})
