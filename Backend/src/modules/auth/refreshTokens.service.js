const { createHash, randomBytes } = require('node:crypto')
const env = require('../../config/env')
const { getSupabaseClient } = require('../../database/client')

function createAuthError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

const INVALID_REFRESH_MESSAGE = 'Your session is no longer valid. Please sign in again.'

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex')
}

function generateRawToken() {
  return randomBytes(32).toString('base64url')
}

async function issueRefreshToken(userId, expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_MINUTES * 60 * 1000).toISOString()) {
  const rawToken = generateRawToken()

  const { error } = await getSupabaseClient()
    .from('refresh_tokens')
    .insert({ user_id: userId, token_hash: hashToken(rawToken), expires_at: expiresAt })

  if (error) {
    throw createAuthError(500, 'REFRESH_TOKEN_ISSUE_FAILED', 'Unable to start session.')
  }

  return rawToken
}

async function revokeById(rowId) {
  const { error } = await getSupabaseClient()
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', rowId)
    .is('revoked_at', null)

  if (error) {
    throw createAuthError(500, 'REFRESH_TOKEN_REVOKE_FAILED', 'Unable to end session.')
  }
}

async function rotateRefreshToken(rawToken) {
  const authService = require('./auth.service')

  const newRawToken = generateRawToken()
  const { data, error } = await getSupabaseClient().rpc('rotate_refresh_token', {
    p_token_hash: hashToken(rawToken),
    p_replacement_token_hash: hashToken(newRawToken),
  }).single()

  if (error) {
    throw createAuthError(500, 'REFRESH_QUERY_FAILED', 'Unable to refresh session.')
  }

  if (data?.outcome === 'reused') {
    throw createAuthError(401, 'REFRESH_TOKEN_REUSED', INVALID_REFRESH_MESSAGE)
  }

  if (data?.outcome !== 'rotated' || !data.user_id || !data.expires_at) {
    throw createAuthError(401, 'INVALID_REFRESH_TOKEN', INVALID_REFRESH_MESSAGE)
  }

  const user = await authService.getAuthenticatedUser({ sub: data.user_id })

  return { user, rawToken: newRawToken, expiresAt: data.expires_at }
}

async function revokeRefreshToken(rawToken) {
  const { data: row, error } = await getSupabaseClient()
    .from('refresh_tokens')
    .select('id, user_id, revoked_at')
    .eq('token_hash', hashToken(rawToken))
    .maybeSingle()

  if (error) {
    throw createAuthError(500, 'REFRESH_QUERY_FAILED', 'Unable to end session.')
  }

  if (!row || row.revoked_at) return

  await revokeById(row.id)
}

module.exports = {
  hashToken,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
}
