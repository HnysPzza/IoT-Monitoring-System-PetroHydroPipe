const alertsService = require('./alerts.service')
const { openSseStream } = require('../../shared/sse/openSseStream')
const { DASHBOARD_STREAM_ROLES } = require('../../shared/sse/streamPolicies')

async function listAlerts(req, res) {
  const alerts = await alertsService.listAlerts()
  res.json({ alerts })
}

async function acknowledgeAlert(req, res) {
  const alert = await alertsService.acknowledgeAlert({
    alertId: req.validated.params.id,
    actorUser: req.user,
  })

  res.json({ alert })
}

async function streamAlerts(req, res) {
  openSseStream({
    req,
    res,
    streamName: 'alerts',
    allowedRoles: DASHBOARD_STREAM_ROLES,
    allowedEventNames: ['alert.created', 'alert.updated', 'alert.acknowledged', 'alert.resolved'],
    subscribe: alertsService.subscribeToAlertEvents,
    toClientEvent: (event) => ({
      type: event.type,
      payload: { alert: event.alert },
    }),
  })
}

module.exports = {
  acknowledgeAlert,
  listAlerts,
  streamAlerts,
}
