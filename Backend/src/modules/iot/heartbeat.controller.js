const iotService = require('./iot.service')

/**
 * POST /api/iot/heartbeats
 * Device-authenticated connectivity and activity observation.
 */
async function createHeartbeat(req, res) {
  const heartbeat = await iotService.createHeartbeat({
    sensor: req.iotDevice,
    payload: req.validated.body,
  })

  res.status(200).json({ heartbeat })
}

module.exports = {
  createHeartbeat,
}
