const alertsService = require('./alerts.service')

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

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
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
  res.flushHeaders?.()
  req.socket.setTimeout(0)

  writeSseEvent(res, 'heartbeat', { ok: true, timestamp: new Date().toISOString() })

  const unsubscribe = alertsService.subscribeToAlertEvents((event) => {
    writeSseEvent(res, event.type, { alert: event.alert })
  })
  const heartbeatId = setInterval(() => {
    writeSseEvent(res, 'heartbeat', { ok: true, timestamp: new Date().toISOString() })
  }, 30000)

  req.on('close', () => {
    clearInterval(heartbeatId)
    unsubscribe()

    if (!res.writableEnded) {
      res.end()
    }
  })
}

module.exports = {
  acknowledgeAlert,
  listAlerts,
  streamAlerts,
}
