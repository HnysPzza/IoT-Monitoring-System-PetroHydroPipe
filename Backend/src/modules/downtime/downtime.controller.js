const downtimeService = require('./downtime.service')
const { openSseStream } = require('../../shared/sse/openSseStream')
const { DASHBOARD_STREAM_ROLES } = require('../../shared/sse/streamPolicies')

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

async function streamDowntime(req, res) {
  openSseStream({
    req,
    res,
    streamName: 'downtime',
    allowedRoles: DASHBOARD_STREAM_ROLES,
    allowedEventNames: ['downtime.created', 'downtime.updated', 'downtime.resolved'],
    subscribe: downtimeService.subscribeToDowntimeEvents,
    toClientEvent: (event) => ({
      type: event.type,
      payload: { downtime: event.downtime },
    }),
  })
}

module.exports = {
  listDowntime,
  streamDowntime,
  updateDowntime,
}
