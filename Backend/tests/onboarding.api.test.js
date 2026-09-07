const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

test('setup validates input, rejects foreign origins, and requires no login', async () => {
  const calls = []
  const app = loadAppWithMocks({
    'src/modules/auth/onboarding.service.js': { setupPassword: async (body) => calls.push(body) },
  })
  await withTestServer(app, async (baseUrl) => {
    const body = { token: 'a'.repeat(64), password: 'a-long-new-password' }
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
    const allowed = await requestJson(baseUrl, '/api/auth/change-password', { method: 'POST', headers, body: { currentPassword: 'temporary', password: 'my-new-long-password' } })
    assert.equal(allowed.response.status, 200)
    assert.equal(changed, true)
  })
})
