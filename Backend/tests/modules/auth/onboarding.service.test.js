const assert = require('node:assert/strict')
const test = require('node:test')
const { loadAppWithMocks } = require('../../helpers/appTestUtils')

test('link validation checks persisted eligibility without writing or exposing account details', async () => {
  const token = 'b'.repeat(64)
  const now = Date.now()
  const active = { purpose: 'setup', expires_at: new Date(now + 60000).toISOString(), used_at: null, users: { status: 'Active', deleted_at: null, onboarding_state: 'Invited' } }
  let result = { data: active, error: null }
  const query = {
    select(fields) { assert.equal(fields, 'purpose, expires_at, used_at, users!inner(status, deleted_at, onboarding_state)'); return query },
    eq(field, value) { assert.equal(field, 'token_hash'); assert.equal(value, require('../../../src/modules/auth/onboarding.service').hashToken(token)); return query },
    async maybeSingle() { return result },
  }
  loadAppWithMocks({ 'src/database/client.js': { getSupabaseClient: () => ({ from(table) { assert.equal(table, 'password_setup_tokens'); return query } }) } })
  const service = require('../../../src/modules/auth/onboarding.service')
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

test('password reset validation accepts only active Ready accounts and reset-purpose tokens', async () => {
  const token = 'c'.repeat(64)
  const now = Date.now()
  const active = { purpose: 'reset', expires_at: new Date(now + 60000).toISOString(), used_at: null, users: { status: 'Active', deleted_at: null, onboarding_state: 'Ready' } }
  let result = { data: active, error: null }
  const query = {
    select(fields) { assert.equal(fields, 'purpose, expires_at, used_at, users!inner(status, deleted_at, onboarding_state)'); return query },
    eq(field, value) { assert.equal(field, 'token_hash'); assert.equal(value, require('../../../src/modules/auth/onboarding.service').hashToken(token)); return query },
    async maybeSingle() { return result },
  }
  loadAppWithMocks({ 'src/database/client.js': { getSupabaseClient: () => ({ from(table) { assert.equal(table, 'password_setup_tokens'); return query } }) } })
  const service = require('../../../src/modules/auth/onboarding.service')

  const valid = await service.validatePasswordResetToken({ token })
  assert.ok(valid.validForMs > 0 && valid.validForMs <= 60000)
  for (const data of [
    null,
    { ...active, purpose: 'setup' },
    { ...active, used_at: new Date(now).toISOString() },
    { ...active, expires_at: new Date(now).toISOString() },
    ...[
      { status: 'Inactive' },
      { deleted_at: new Date(now).toISOString() },
      { onboarding_state: 'Invited' },
    ].map((user) => ({ ...active, users: { ...active.users, ...user } })),
  ]) {
    result = { data, error: null }
    await assert.rejects(service.validatePasswordResetToken({ token }), { status: 400, code: 'PASSWORD_RESET_LINK_INVALID' })
  }
})

test('admin reset stores only a token hash and sends a dedicated reset link', async () => {
  let saved
  let email
  const query = {
    select(fields) { assert.equal(fields, 'email'); return query },
    eq(field, value) { assert.equal(field, 'id'); assert.equal(value, 'target-user'); return query },
    async maybeSingle() { return { data: { email: 'operator@example.test' }, error: null } },
  }
  loadAppWithMocks({
    'src/config/env.js': { NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173', ACCOUNT_SETUP_ORIGIN: 'http://localhost:5173', BREVO_API_KEY: 'test-only', BREVO_FROM_EMAIL: 'sender@example.test' },
    'src/database/client.js': { getSupabaseClient: () => ({ from: () => query, rpc: async (name, values) => { saved = { name, values }; return { data: null, error: null } } }) },
    'src/modules/email/email.service.js': { createEmailService: () => ({ sendTransactionalEmail: async (message) => { email = message } }) },
  })
  const service = require('../../../src/modules/auth/onboarding.service')
  const result = await service.requestPasswordReset({ userId: 'target-user', actorUserId: 'admin-user' })
  const token = email.textContent.match(/reset-password#token=([0-9a-f]{64})/)[1]

  assert.deepEqual(result, { delivery: 'accepted' })
  assert.equal(saved.name, 'request_user_password_reset')
  assert.deepEqual(saved.values, { p_actor: 'admin-user', p_user_id: 'target-user', p_token_hash: service.hashToken(token) })
  assert.equal(JSON.stringify(saved).includes(token), false)
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.match(email.subject, /reset/i)
  assert.ok(email.htmlContent.includes(`href="http://localhost:5173/reset-password#token=${token}"`))
  assert.match(email.htmlContent, /Saving your new password signs out your active sessions/)
})

test('Add user stores only a token hash and preserves the account when email fails', async () => {
  let saved
  let email
  loadAppWithMocks({
    'src/config/env.js': { NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:5173', ACCOUNT_SETUP_ORIGIN: 'http://localhost:5173', BREVO_API_KEY: 'test-only', BREVO_FROM_EMAIL: 'sender@example.test' },
    'src/database/client.js': { getSupabaseClient: () => ({ rpc: async (name, values) => { saved = { name, values }; return { data: { id: 'new-user' }, error: null } } }) },
    'src/modules/email/email.service.js': { createEmailService: () => ({ sendTransactionalEmail: async (message) => { email = message; throw Object.assign(new Error('provider failure'), { code: 'EMAIL_DELIVERY_FAILED' }) } }) },
  })
  const service = require('../../../src/modules/auth/onboarding.service')
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
  assert.match(email.htmlContent, /max-width:\s*600px/)
  assert.match(email.htmlContent, /<img\s+src="https:\/\/[^"]+\/logo\.png"\s+height="28px"\s+alt="PetroHydroPipe Logo"/)
  assert.match(email.htmlContent, /IoT Monitoring System/)
  assert.match(email.htmlContent, /Account invitation/)
  assert.match(email.htmlContent, /Your administrator has created your account\. Choose a secure password to get started with the monitoring system\./)
  assert.match(email.htmlContent, /<a[^>]+style="[^"]*background-color:\s*#2563eb[^>]+>Set up password<\/a>/)
  assert.match(email.htmlContent, /font-variant-numeric:\s*tabular-nums/)
  assert.match(email.htmlContent, /Valid for one hour (?:\u00b7|&middot;) Single-use link/)
  assert.match(email.htmlContent, /already used|once/i)
  assert.match(email.htmlContent, /If you did not expect this invitation, you can safely ignore this email or contact your administrator\./)
  assert.match(email.htmlContent, /PetroHydroPipe IoT Monitoring System (?:\u00b7|&middot;) Secure Account Access/)
  assert.match(email.textContent, /single.use/i)
})


test('changePassword rejects accounts where must_change_password is false', async () => {
  const bcrypt = require('bcryptjs')
  const passwordHash = await bcrypt.hash('Old-password1!', 10)
  const result = { data: { password_hash: passwordHash, must_change_password: false }, error: null }
  const query = {
    select(fields) { assert.equal(fields, 'password_hash, must_change_password'); return query },
    eq(field, value) { assert.equal(field, 'id'); assert.equal(value, 'user-ready'); return query },
    async maybeSingle() { return result },
  }
  loadAppWithMocks({
    'src/database/client.js': {
      getSupabaseClient: () => ({
        from: (table) => { assert.equal(table, 'users'); return query },
        rpc: async () => { throw new Error('RPC should not be called when must_change_password is false') },
      }),
    },
  })
  const service = require('../../../src/modules/auth/onboarding.service')
  await assert.rejects(
    service.changePassword('user-ready', { currentPassword: 'Old-password1!', password: 'New-password1!' }),
    { status: 403, code: 'ACCOUNT_OPERATION_INVALID' },
  )
})

test('updateUserStatus and archiveUser use atomic RPCs and map error codes accurately', async () => {
  const rpcCalls = []
  let rpcResponse = { data: null, error: null }

  loadAppWithMocks({
    'src/database/client.js': {
      getSupabaseClient: () => ({
        from: () => { throw new Error('Direct users table access should not be used') },
        rpc: async (name, params) => {
          rpcCalls.push({ name, params })
          return rpcResponse
        },
      }),
    },
  })

  const usersService = require('../../../src/modules/users/users.service')

  await assert.rejects(
    usersService.updateUserStatus({ userId: 'admin-1', status: 'Inactive', actorUserId: 'admin-1' }),
    { status: 400, code: 'SELF_DEACTIVATION_BLOCKED' },
  )
  await assert.rejects(
    usersService.archiveUser({ userId: 'admin-1', actorUserId: 'admin-1' }),
    { status: 400, code: 'SELF_ARCHIVE_BLOCKED' },
  )
  assert.equal(rpcCalls.length, 0)

  rpcResponse = {
    data: {
      id: 'user-2',
      name: 'Operator Two',
      username: 'operator02',
      email: 'op2@example.test',
      role: 'Production Supervisor',
      status: 'Inactive',
      mustChangePassword: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      lastLoginAt: null,
      deletedAt: null,
    },
    error: null,
  }
  const updated = await usersService.updateUserStatus({
    userId: 'user-2',
    status: 'Inactive',
    actorUserId: 'admin-1',
  })
  assert.equal(updated.id, 'user-2')
  assert.equal(updated.status, 'Inactive')
  assert.equal(updated.role, 'Production Supervisor')
  assert.deepEqual(rpcCalls[0], {
    name: 'update_user_account_status',
    params: { p_actor: 'admin-1', p_user_id: 'user-2', p_status: 'Inactive' },
  })

  rpcResponse = {
    data: {
      id: 'user-2',
      name: 'Operator Two',
      username: 'operator02',
      email: 'op2@example.test',
      role: 'Production Supervisor',
      status: 'Inactive',
      mustChangePassword: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      lastLoginAt: null,
      deletedAt: '2026-07-02T00:00:00.000Z',
    },
    error: null,
  }
  const archived = await usersService.archiveUser({
    userId: 'user-2',
    actorUserId: 'admin-1',
  })
  assert.equal(archived.id, 'user-2')
  assert.equal(archived.status, 'Inactive')
  assert.equal(archived.deletedAt, '2026-07-02T00:00:00.000Z')
  assert.deepEqual(rpcCalls[1], {
    name: 'archive_user_account',
    params: { p_actor: 'admin-1', p_user_id: 'user-2' },
  })

  rpcResponse = { data: null, error: { code: 'P0002', message: 'User not found.' } }
  await assert.rejects(
    usersService.updateUserStatus({ userId: 'missing', status: 'Inactive', actorUserId: 'admin-1' }),
    { status: 404, code: 'USER_NOT_FOUND' },
  )

  rpcResponse = { data: null, error: { code: '42501', message: 'Admin account cannot be deactivated.' } }
  await assert.rejects(
    usersService.updateUserStatus({ userId: 'other-admin', status: 'Inactive', actorUserId: 'admin-1' }),
    { status: 403, code: 'ACCOUNT_PROTECTED' },
  )

  rpcResponse = { data: null, error: { code: '08006', message: 'connection failure' } }
  await assert.rejects(
    usersService.archiveUser({ userId: 'user-2', actorUserId: 'admin-1' }),
    { status: 500, code: 'USER_ARCHIVE_FAILED' },
  )
})
