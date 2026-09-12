const test = require('node:test')
const assert = require('node:assert/strict')
const { createUserSchema, listUsersSchema } = require('../src/modules/users/users.model')
const { setupPasswordSchema } = require('../src/modules/auth/auth.model')
const { changePasswordSchema, loginSchema } = require('../src/modules/auth/auth.model')

test('new passwords require all four character categories without breaking legacy login', () => {
  for (const password of ['aaaaaaaaaaaa', '123456789012', 'ABCDEFGHIJ1!', 'abcdefghij1!', 'Abcdefghijk!', 'Abcdefghijk1', 'Abcdefghij1 ']) {
    assert.equal(setupPasswordSchema.safeParse({ body: { token: 'a'.repeat(64), password } }).success, false, password)
    assert.equal(changePasswordSchema.safeParse({ body: { currentPassword: 'old', password } }).success, false, password)
  }
  for (const password of ['Abcdefghij1!', 'Aa1!' + 'x'.repeat(68), 'Aa1!' + 'é'.repeat(34)]) {
    assert.equal(setupPasswordSchema.safeParse({ body: { token: 'a'.repeat(64), password } }).success, true)
  }
  for (const password of ['Abcdefghi1!', 'Aa1!😀😀😀😀', 'Aa1!' + 'x'.repeat(69), 'Aa1!' + 'é'.repeat(35), null, 123, {}]) {
    assert.equal(setupPasswordSchema.safeParse({ body: { token: 'a'.repeat(64), password } }).success, false)
  }
  assert.equal(loginSchema.safeParse({ body: { username: 'legacy', password: 'old' } }).success, true)
})

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
  assert.equal(setupPasswordSchema.safeParse({ body: { token: 'a'.repeat(64), password: 'Strong-password1!' } }).success, true)
  assert.equal(setupPasswordSchema.safeParse({ body: { token: 'a'.repeat(64), password: 'é'.repeat(40) } }).success, false)
})
