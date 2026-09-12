const env = require('../../config/env')

const REFRESH_COOKIE_NAME = 'ph_refresh'

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: '/api/auth',
    maxAge: maxAgeMs,
  }
}

function getRefreshCookieMaxAge(expiresAt) {
  if (!expiresAt) return env.REFRESH_TOKEN_TTL_MINUTES * 60 * 1000

  const expiresAtMs = Date.parse(expiresAt)
  return Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - Date.now()) : 0
}

function setRefreshCookie(res, rawToken, expiresAt) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, cookieOptions(getRefreshCookieMaxAge(expiresAt)))
}

function clearRefreshCookie(res) {
  res.cookie(REFRESH_COOKIE_NAME, '', cookieOptions(0))
}

function readRefreshCookie(req) {
  const header = req.headers.cookie
  if (!header) return null

  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) continue

    const name = part.slice(0, separatorIndex).trim()
    if (name === REFRESH_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(separatorIndex + 1).trim())
      } catch {
        return null
      }
    }
  }

  return null
}

module.exports = {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
}
