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

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function streamDowntime(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
  res.flushHeaders?.()
  req.socket.setTimeout(0)

  writeSseEvent(res, 'heartbeat', { ok: true, timestamp: new Date().toISOString() })

  const unsubscribe = downtimeService.subscribeToDowntimeEvents((event) => {
    writeSseEvent(res, event.type, { downtime: event.downtime })
  })
  const heartbeatId = setInterval(() => {
    writeSseEvent(res, 'heartbeat', { ok: true, timestamp: new Date().toISOString() })
  }, 30000)

  req.on('close', () => {
    clearInterval(heartbeatId)
    unsubscribe()

    if (!res.writableEnded) res.end()
  })
}

module.exports = {
  listDowntime,
  streamDowntime,
  updateDowntime,
}
