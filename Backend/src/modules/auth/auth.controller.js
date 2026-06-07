const authService = require('./auth.service')

async function login(req, res) {
  const result = await authService.login(req.validated.body)
  res.json(result)
}

async function me(req, res) {
  const user = await authService.getAuthenticatedUser(req.user)
  res.json({ user })
}

module.exports = {
  login,
  me,
}
