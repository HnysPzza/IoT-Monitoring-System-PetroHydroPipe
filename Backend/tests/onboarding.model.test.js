const test = require('node:test')
const assert = require('node:assert/strict')
const { createUserSchema, listUsersSchema } = require('../src/modules/users/users.model')
const { setupPasswordSchema } = require('../src/modules/auth/auth.model')

test('Add user accepts no password and rejects Admin or supplied credentials', () => {
  const body = { name: 'Operator', username: 'operator', email: 'operator@example.test', role: 'Production Supervisor' }
  assert.equal(createUserSchema.safeParse({ body }).success, true)
  assert.equal(createUserSchema.safeParse({ body: { ...body, role: 'Admin' } }).success, false)
  assert.equal(createUserSchema.safeParse({ body: { ...body, password: 'temporary' } }).success, false)
})

test('directory bounds pagination and setup bounds bcrypt input', () => {
  assert.equal(listUsersSchema.safeParse({ query: { page: '0' } }).success, false)
  assert.equal(listUsersSchema.safeParse({ query: { sort: 'password_hash' } }).success, false)
  assert.equal(listUsersSchema.parse({ query: {} }).query.limit, 10)
  assert.equal(setupPasswordSchema.safeParse({ body: { token: 'a'.repeat(64), password: 'strong-password' } }).success, true)
  assert.equal(setupPasswordSchema.safeParse({ body: { token: 'a'.repeat(64), password: 'é'.repeat(40) } }).success, false)
})
