const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const env = require('../../config/env')
const { getSupabaseClient } = require('../../database/client')
const { recordAuditLog } = require('../audit/audit.service')

const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.'

const TOKEN_EXPIRES_IN = `${env.ACCESS_TOKEN_EXPIRES_MINUTES}m`

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

  return userRecord.roles?.name || userRecord.role || null
}

function toAuthUser(userRecord) {
  // Safe response shape: never send password_hash to the frontend.
  return {
    id: userRecord.id,
    name: userRecord.name,
    username: userRecord.username,
    email: userRecord.email,
    role: getRoleName(userRecord),
    mustChangePassword: Boolean(userRecord.must_change_password),
  }
}

function getSessionUserSelect() {
  return `
    id,
    name,
    username,
    email,
    status,
    must_change_password,
    onboarding_state,
    deleted_at,
    roles (
      name
    )
  `
}

function getLoginUserSelect() {
  return `${getSessionUserSelect()}, password_hash`
}

async function findUserByUsername(username) {
  // Usernames are stored lowercase so login works consistently.
  const normalizedUsername = username.trim().toLowerCase()
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('users')
    .select(getLoginUserSelect())
    .eq('username', normalizedUsername)
    .maybeSingle()

  if (error) {
    throw createAuthError(500, 'AUTH_QUERY_FAILED', 'Unable to authenticate user.')
  }

  return data
}

async function findUserById(userId, { signal } = {}) {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('users')
    .select(getSessionUserSelect())
    .eq('id', userId)

  if (signal) query = query.abortSignal(signal)

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw createAuthError(500, 'AUTH_QUERY_FAILED', 'Unable to load authenticated user.')
  }

  return data
}

async function verifyPassword(password, passwordHash) {
  // bcrypt compares the raw login password with the stored hash.
  return bcrypt.compare(password, passwordHash)
}

function createAuthToken(userRecord, sessionId) {
  if (!env.JWT_SECRET) {
    throw createAuthError(500, 'JWT_NOT_CONFIGURED', 'JWT_SECRET is not configured.')
  }

  // JWT carries only the claims needed by protected routes and role checks.
  return jwt.sign(
    {
      username: userRecord.username,
      role: getRoleName(userRecord),
      ...(sessionId ? { sid: sessionId } : {}),
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
    // Login should still succeed even if this audit-style timestamp update fails.
    console.warn('Unable to update last_login_at for user.', { userId })
  }
}

async function login({ username, password }) {
  // Main login flow: find active user, verify password, then issue token.
  const userRecord = await findUserByUsername(username)
  const normalizedUsername = username.trim().toLowerCase()

  if (!userRecord || userRecord.status !== 'Active' || userRecord.deleted_at || userRecord.onboarding_state === 'Invited' || !userRecord.password_hash) {
    await recordAuditLog({
      userId: userRecord?.id || null,
      action: 'LOGIN_FAILED',
      entityType: 'auth',
      metadata: {
        username: normalizedUsername,
        reason: userRecord?.deleted_at ? 'archived_account' : userRecord?.status === 'Inactive' ? 'inactive_account' : 'invalid_credentials',
      },
    })
    throw createAuthError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE)
  }

  const passwordMatches = await verifyPassword(password, userRecord.password_hash)

  if (!passwordMatches) {
    await recordAuditLog({
      userId: userRecord.id,
      action: 'LOGIN_FAILED',
      entityType: 'auth',
      metadata: {
        username: normalizedUsername,
        reason: 'invalid_credentials',
      },
    })
    throw createAuthError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE)
  }

  const token = createAuthToken(userRecord)
  await updateLastLoginAt(userRecord.id)
  await recordAuditLog({
    userId: userRecord.id,
    action: 'LOGIN_SUCCESS',
    entityType: 'auth',
    metadata: {
      username: userRecord.username,
      role: getRoleName(userRecord),
    },
  })

  return {
    token,
    verifiedPasswordHash: userRecord.password_hash,
    user: toAuthUser(userRecord),
  }
}

async function getAuthenticatedUser(tokenPayload, options = {}) {
  if (typeof tokenPayload.sid !== 'string' || !/^[0-9a-f-]{36}$/i.test(tokenPayload.sid)) {
    throw createAuthError(401, 'UNAUTHENTICATED', 'Sign in again to start a verified session.')
  }
  // /me refreshes the safe user shape from the database using the JWT subject.
  const userRecord = await findUserById(tokenPayload.sub, options)

  if (!userRecord) {
    throw createAuthError(401, 'UNAUTHENTICATED', 'Authenticated user no longer exists.')
  }

  if (userRecord.deleted_at) {
    throw createAuthError(403, 'ACCOUNT_ARCHIVED', 'User account is archived.')
  }

  if (userRecord.status !== 'Active') {
    throw createAuthError(403, 'ACCOUNT_INACTIVE', 'User account is inactive.')
  }

  if (userRecord.onboarding_state === 'Invited') {
    throw createAuthError(403, 'ACCOUNT_SETUP_REQUIRED', 'Finish account setup before signing in.')
  }
  let query = getSupabaseClient().from('auth_sessions').select('id').eq('id', tokenPayload.sid)
    .eq('user_id', userRecord.id).is('revoked_at', null).gt('expires_at', new Date().toISOString())
  if (options.signal) query = query.abortSignal(options.signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw createAuthError(500, 'AUTH_QUERY_FAILED', 'Unable to verify session.')
  if (!data) throw createAuthError(401, 'UNAUTHENTICATED', 'Session has ended. Sign in again.')

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
