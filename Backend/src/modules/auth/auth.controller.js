const authService = require('./auth.service')

async function login(req, res) {
  // Controller stays thin; service handles Supabase lookup, bcrypt, and JWT signing.
  const result = await authService.login(req.validated.body)
  res.json(result)
}

async function me(req, res) {
  // authenticate already refreshed this user from the database.
  res.json({ user: req.authenticatedUser })
}

module.exports = {
  login,
  me,
}
