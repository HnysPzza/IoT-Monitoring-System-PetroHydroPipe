const authService = require('./auth.service')
const refreshTokens = require('./refreshTokens.service')
const {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} = require('./refreshToken.cookie')

async function login(req, res) {
  // Controller stays thin; service handles Supabase lookup, bcrypt, and JWT signing.
  const existingRawRefreshToken = readRefreshCookie(req)
  const result = await authService.login(req.validated.body)

  if (existingRawRefreshToken) {
    await refreshTokens.revokeRefreshToken(existingRawRefreshToken)
  }

  const { rawToken, sessionId, expiresAt } = await refreshTokens.issueRefreshToken(result.user.id)
  setRefreshCookie(res, rawToken, expiresAt)
  res.set('Cache-Control', 'no-store').json({ ...result, token: authService.createAuthToken(result.user, sessionId), sessionId })
}

async function me(req, res) {
  // authenticate already refreshed this user from the database.
  res.json({ user: req.authenticatedUser })
}

async function refresh(req, res) {
  // The HttpOnly refresh cookie is the only accepted input; the response
  // mirrors the login shape so the frontend reuses one code path.
  const rawToken = readRefreshCookie(req)

  try {
    const { user, rawToken: rotatedToken, expiresAt, sessionId } = await refreshTokens.rotateRefreshToken(rawToken)
    const accessToken = authService.createAuthToken(user, sessionId)

    setRefreshCookie(res, rotatedToken, expiresAt)
    res.set('Cache-Control', 'no-store').json({ token: accessToken, user, sessionId })
  } catch (error) {
    // A rejected refresh token must never linger in the browser.
    if (error.status === 401 || error.status === 403) clearRefreshCookie(res)
    throw error
  }
}

async function logout(req, res) {
  const rawToken = readRefreshCookie(req)

  try {
    if (rawToken) {
      await refreshTokens.revokeRefreshToken(rawToken)
    }
  } finally {
    clearRefreshCookie(res)
  }

  res.set('Cache-Control', 'no-store').json({ loggedOut: true })
}

module.exports = {
  login,
  logout,
  me,
  refresh,
}
