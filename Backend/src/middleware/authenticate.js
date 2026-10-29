const jwt = require('jsonwebtoken')
const env = require('../config/env')
const authService = require('../modules/auth/auth.service')

async function authenticateAllowingPasswordChange(req, res, next) {
  const authorization = req.get('authorization') || ''
  const [scheme, token] = authorization.split(' ')

  // Protected routes require Authorization: Bearer <jwt-token>.
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Missing bearer token.',
      },
    })
  }

  if (!env.JWT_SECRET) {
    return next(new Error('JWT_SECRET is not configured.'))
  }

  try {
    // JWT identifies the user; current role/status is refreshed from the database.
    const tokenPayload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })
    const currentUser = await authService.getAuthenticatedUser(tokenPayload)
    req.tokenPayload = tokenPayload
    req.authenticatedUser = currentUser
    req.user = {
      ...currentUser,
      sub: currentUser.id,
    }
    return next()
  } catch (error) { //catch any 403 or 401 errors
    if (error.status) {
      return next(error)
    }
    //if catch error respond with http 401 status or invalid/expired token
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid or expired token.',
      },
    })
  }
}

function authenticate(req, res, next) {
  return authenticateAllowingPasswordChange(req, res, (error) => {
    if (error) return next(error)
    if (req.authenticatedUser.mustChangePassword) {
      return res.status(403).json({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password before using the system.' } })
    }
    return next()
  })
}

module.exports = authenticate
module.exports.authenticateAllowingPasswordChange = authenticateAllowingPasswordChange
