// Live smoke test for the session lifecycle (Asset 7 fix).
// Requires migrations 026 and 027 to be applied first.
// and the backend dev server to be running (npm run dev or npm start).
//
// Usage: node scripts/smoke-auth-session.js <username> <password>
// Env: reads Backend/.env through config/env.js.

const BASE_URL = process.env.AUTH_SMOKE_BASE_URL || 'http://localhost:3000'
const COOKIE_NAME = 'ph_refresh'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`)
  }

  console.log(`ok - ${message}`)
}

function getRefreshCookie(response) {
  const raw = response.headers.get('set-cookie') || ''
  return raw.split(/,(?=[^;]+=)/).find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`)) || null
}

function extractToken(cookie) {
  return decodeURIComponent(cookie.split('=')[1].split(';')[0])
}

async function main() {
  const username = process.env.AUTH_SMOKE_USERNAME
  const password = process.env.AUTH_SMOKE_PASSWORD

  if (!username || !password) {
    throw new Error('Set AUTH_SMOKE_USERNAME and AUTH_SMOKE_PASSWORD for a disposable account; replay revokes all its sessions.')
  }

  // 1. Login issues both an access token and a hardened refresh cookie.
  const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!loginResponse.ok) {
    throw new Error(`FAIL: login returned ${loginResponse.status}: ${await loginResponse.text()}`)
  }

  const loginBody = await loginResponse.json()
  assert(loginBody.token, 'login returned an access token')

  const setCookie = getRefreshCookie(loginResponse)
  assert(setCookie, 'login set the refresh cookie')
  assert(/httponly/i.test(setCookie), 'refresh cookie is HttpOnly')
  assert(/samesite=strict/i.test(setCookie), 'refresh cookie is SameSite=Strict')
  assert(/path=\/api\/auth(?:;|$)/i.test(setCookie), 'refresh cookie is scoped to /api/auth')
  const firstRefreshToken = extractToken(setCookie)

  const decoded = JSON.parse(Buffer.from(loginBody.token.split('.')[1], 'base64url').toString('utf8'))
  const lifetimeSeconds = decoded.exp - decoded.iat
  assert(lifetimeSeconds <= 60 * 60, `access token lifetime is ${lifetimeSeconds / 60} minutes (max 60)`)

  // 2. The access token works on protected routes.
  const meResponse = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  })
  assert(meResponse.ok, 'access token authenticates /api/auth/me')

  // 3. Refresh rotates the cookie and returns a fresh access token.
  const refreshResponse = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${COOKIE_NAME}=${firstRefreshToken}` },
  })

  if (!refreshResponse.ok) {
    throw new Error(`FAIL: refresh returned ${refreshResponse.status}: ${await refreshResponse.text()}`)
  }

  const refreshBody = await refreshResponse.json()
  assert(refreshBody.token, 'refresh returned an access token')
  const refreshedClaims = JSON.parse(Buffer.from(refreshBody.token.split('.')[1], 'base64url').toString('utf8'))
  assert(refreshedClaims.sub === decoded.sub && refreshedClaims.sid === decoded.sid && decoded.sid === loginBody.sessionId, 'refresh preserves account and session identity')
  assert(refreshBody.sessionId === loginBody.sessionId, 'refresh preserves session ID')
  const rotatedCookie = getRefreshCookie(refreshResponse)
  assert(rotatedCookie && extractToken(rotatedCookie) !== firstRefreshToken, 'refresh cookie was rotated')
  const secondRefreshToken = extractToken(rotatedCookie)

  // 4. Replaying the old cookie triggers reuse detection and revokes everything.
  const replayResponse = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${COOKIE_NAME}=${firstRefreshToken}` },
  })
  assert(replayResponse.status === 401, 'replaying a rotated cookie is rejected with 401')

  const stolenResponse = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${COOKIE_NAME}=${secondRefreshToken}` },
  })
  assert(stolenResponse.status === 401, 'the whole session family is revoked after reuse detection')

  // 5. Login again to leave the tester a working session, then log out.
  const reloginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  assert(reloginResponse.ok, 'second login succeeds')
  const reloginCookie = getRefreshCookie(reloginResponse)

  const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: `${COOKIE_NAME}=${extractToken(reloginCookie)}` },
  })
  assert(logoutResponse.ok, 'logout succeeds')

  const afterLogout = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: reloginCookie.split(';')[0] },
  })
  assert(afterLogout.status === 401, 'refresh is rejected after logout')

  console.log('\nAll session smoke checks passed.')
  console.log('Manual check: open the app in a browser, log in, and confirm Application > Local Storage has no iot_monitoring_auth entry; reload keeps you signed in.')
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
