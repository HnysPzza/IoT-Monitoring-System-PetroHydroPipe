const assert = require('node:assert/strict')
const test = require('node:test')
const { loadAppWithMocks } = require('./helpers/appTestUtils')

test('link validation checks persisted eligibility without writing or exposing account details', async () => {
  const token = 'b'.repeat(64)
  const now = Date.now()
  const active = { expires_at: new Date(now + 60000).toISOString(), used_at: null, users: { status: 'Active', deleted_at: null, onboarding_state: 'Invited' } }
  let result = { data: active, error: null }
  const query = {
    select(fields) { assert.equal(fields, 'expires_at, used_at, users!inner(status, deleted_at, onboarding_state)'); return query },
    eq(field, value) { assert.equal(field, 'token_hash'); assert.equal(value, require('../src/modules/auth/onboarding.service').hashToken(token)); return query },
    async maybeSingle() { return result },
  }
  loadAppWithMocks({ 'src/database/client.js': { getSupabaseClient: () => ({ from(table) { assert.equal(table, 'password_setup_tokens'); return query } }) } })
  const service = require('../src/modules/auth/onboarding.service')
  assert.equal(typeof service.validateSetupToken, 'function')
  const valid = await service.validateSetupToken({ token })
  assert.deepEqual(Object.keys(valid), ['validForMs'])
  assert.ok(valid.validForMs > 0 && valid.validForMs <= 60000)
  for (const data of [null, { ...active, used_at: new Date(now).toISOString() }, { ...active, expires_at: new Date(now).toISOString() }, { ...active, expires_at: 'invalid' }, ...[
    { status: 'Inactive' }, { deleted_at: new Date(now).toISOString() }, { onboarding_state: 'Ready' },
  ].map((user) => ({ ...active, users: { ...active.users, ...user } }))]) {
    result = { data, error: null }
    await assert.rejects(service.validateSetupToken({ token }), { status: 400, code: 'SETUP_LINK_INVALID' })
  }
  result = { data: null, error: { code: '08006' } }
  await assert.rejects(service.validateSetupToken({ token }), { status: 500, code: 'SETUP_LINK_QUERY_FAILED' })
})

test('Add user stores only a token hash and preserves the account when email fails', async () => {
  let saved
  let email
  loadAppWithMocks({
    'src/config/env.js': { NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173', ACCOUNT_SETUP_ORIGIN: 'http://localhost:5173', BREVO_API_KEY: 'test-only', BREVO_FROM_EMAIL: 'sender@example.test' },
    'src/database/client.js': { getSupabaseClient: () => ({ rpc: async (name, values) => { saved = { name, values }; return { data: { id: 'new-user' }, error: null } } }) },
    'src/modules/email/email.service.js': { createEmailService: () => ({ sendTransactionalEmail: async (message) => { email = message; throw Object.assign(new Error('provider failure'), { code: 'EMAIL_DELIVERY_FAILED' }) } }) },
  })
  const service = require('../src/modules/auth/onboarding.service')
  const result = await service.addUser({ actorUserId: 'admin', name: 'Operator', username: 'operator', email: 'operator@example.test', role: 'Production Supervisor' })
  assert.deepEqual(result, { user: { id: 'new-user' }, delivery: 'unconfirmed' })
  const token = email.textContent.match(/#token=([0-9a-f]{64})/)[1]
  assert.equal(saved.name, 'add_invited_user')
  assert.equal(saved.values.p_token_hash, service.hashToken(token))
  assert.equal(JSON.stringify(saved).includes(token), false)
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(Object.hasOwn(saved.values, 'password'), false)
  assert.ok(email.htmlContent.includes(`href="http://localhost:5173/setup-password#token=${token}"`))
  assert.match(email.htmlContent, /<html lang="en">/)
  assert.match(email.htmlContent, /<a[^>]+style="[^"]*background[^>]+>Set up password<\/a>/)
  assert.match(email.htmlContent, /already used|once/i)
  assert.match(email.textContent, /single.use/i)
})
