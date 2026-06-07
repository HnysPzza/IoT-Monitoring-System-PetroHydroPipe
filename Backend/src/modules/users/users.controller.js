const usersService = require('./users.service')

async function listUsers(req, res) {
  const users = await usersService.listUsers()
  res.json({ users })
}

async function listRoles(req, res) {
  const roles = await usersService.listRoles()
  res.json({ roles })
}

async function createUser(req, res) {
  const user = await usersService.createUser(req.validated.body)
  res.status(201).json({ user })
}

async function updateUserStatus(req, res) {
  const user = await usersService.updateUserStatus({
    userId: req.validated.params.id,
    status: req.validated.body.status,
    actorUserId: req.user.sub,
  })

  res.json({ user })
}

module.exports = {
  createUser,
  listRoles,
  listUsers,
  updateUserStatus,
}
