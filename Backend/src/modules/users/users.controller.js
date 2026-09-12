const usersService = require('./users.service')

async function listUsers(req, res) {
  res.json(await usersService.listUsers(req.validated.query))
}

async function listRoles(req, res) {
  const roles = await usersService.listRoles()
  res.json({ roles })
}

async function createUser(req, res) {
  const user = await usersService.createUser({
    ...req.validated.body,
    actorUserId: req.user.sub,
  })
  res.status(201).json(user)
}

async function updateUserStatus(req, res) {
  // actorUserId prevents the current admin from deactivating their own account.
  const user = await usersService.updateUserStatus({
    userId: req.validated.params.id,
    status: req.validated.body.status,
    actorUserId: req.user.sub,
  })

  res.json({ user })
}

async function archiveUser(req, res) {
  // actorUserId prevents the current admin from archiving their own account.
  const archivedUser = await usersService.archiveUser({
    userId: req.validated.params.id,
    actorUserId: req.user.sub,
  })

  res.json({ user: archivedUser })
}

module.exports = {
  archiveUser,
  createUser,
  listRoles,
  listUsers,
  updateUserStatus,
}
