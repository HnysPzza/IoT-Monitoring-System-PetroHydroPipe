const downtimeService = require('./downtime.service')

async function listDowntime(req, res) {
  const result = await downtimeService.listDowntime(req.validated.query)
  res.json(result)
}

async function updateDowntime(req, res) {
  const result = await downtimeService.updateDowntime({
    downtimeId: req.validated.params.id,
    values: req.validated.body,
    actorUserId: req.user.sub,
  })

  res.json(result)
}

module.exports = {
  listDowntime,
  updateDowntime,
}
