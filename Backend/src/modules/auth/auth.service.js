const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const env = require('../../config/env')
const { getSupabaseClient } = require('../../config/supabase')

const TOKEN_EXPIRES_IN = '8h'
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.'

function createAuthError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getRoleName(userRecord) {
  if (Array.isArray(userRecord.roles)) {
    return userRecord.roles[0]?.name || null
  }

  return userRecord.roles?.name || null
}

function toAuthUser(userRecord) {
  return {
    id: userRecord.id,
    name: userRecord.name,
    username: userRecord.username,
    email: userRecord.email,
    role: getRoleName(userRecord),
    mustChangePassword: Boolean(userRecord.must_change_password),
  }
}

function getAuthUserSelect() {
  return `
    id,
    name,
    username,
    email,
    password_hash,
    status,
    must_change_password,
    roles (
      name
    )
  `
}

async function findUserByUsername(username) {
  const normalizedUsername = username.trim().toLowerCase()
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('users')
    .select(getAuthUserSelect())
    .eq('username', normalizedUsername)
    .maybeSingle()

  if (error) {
    throw createAuthError(500, 'AUTH_QUERY_FAILED', 'Unable to authenticate user.')
  }

  return data
}

async function findUserById(userId) {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('users')
    .select(getAuthUserSelect())
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw createAuthError(500, 'AUTH_QUERY_FAILED', 'Unable to load authenticated user.')
  }

  return data
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash)
}

function createAuthToken(userRecord) {
  if (!env.JWT_SECRET) {
    throw createAuthError(500, 'JWT_NOT_CONFIGURED', 'JWT_SECRET is not configured.')
  }

  return jwt.sign(
    {
      username: userRecord.username,
      role: getRoleName(userRecord),
    },
    env.JWT_SECRET,
    {
      subject: userRecord.id,
      expiresIn: TOKEN_EXPIRES_IN,
    },
  )
}

async function updateLastLoginAt(userId) {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    console.warn('Unable to update last_login_at for user.', { userId })
  }
}

async function login({ username, password }) {
  const userRecord = await findUserByUsername(username)

  if (!userRecord || userRecord.status !== 'Active') {
    throw createAuthError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE)
  }

  const passwordMatches = await verifyPassword(password, userRecord.password_hash)

  if (!passwordMatches) {
    throw createAuthError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE)
  }

  const token = createAuthToken(userRecord)
  await updateLastLoginAt(userRecord.id)

  return {
    token,
    user: toAuthUser(userRecord),
  }
}

async function getAuthenticatedUser(tokenPayload) {
  const userRecord = await findUserById(tokenPayload.sub)

  if (!userRecord) {
    throw createAuthError(401, 'UNAUTHENTICATED', 'Authenticated user no longer exists.')
  }

  if (userRecord.status !== 'Active') {
    throw createAuthError(403, 'ACCOUNT_INACTIVE', 'User account is inactive.')
  }

  return toAuthUser(userRecord)
}

module.exports = {
  createAuthToken,
  findUserByUsername,
  getAuthenticatedUser,
  login,
  toAuthUser,
  verifyPassword,
}
