const assert = require('node:assert/strict')
const test = require('node:test')
const { loadAppWithMocks } = require('./helpers/appTestUtils')

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
})
