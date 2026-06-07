const jwt = require('jsonwebtoken')
const env = require('../config/env')

function authenticate(req, res, next) {
  const authorization = req.get('authorization') || ''
  const [scheme, token] = authorization.split(' ')

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
    req.user = jwt.verify(token, env.JWT_SECRET)
    return next()
  } catch {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid or expired token.',
      },
    })
  }
}

module.exports = authenticate
