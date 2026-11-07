const iotService = require('./iot.service')
const { applyDeviceThresholdHeaders } = require('./iot.controller')

/**
 * POST /api/iot/heartbeats
 * Device-authenticated connectivity and activity observation.
 */
async function createHeartbeat(req, res) {
  const [heartbeat, thresholds] = await Promise.all([
    iotService.createHeartbeat({
      sensor: req.iotDevice,
      payload: req.validated.body,
    }),
    typeof iotService.getDeviceOperationalThresholds === 'function'
      ? iotService.getDeviceOperationalThresholds(req.iotDevice)
      : null,
  ])

  applyDeviceThresholdHeaders(res, thresholds)
  res.status(200).json({ heartbeat })
}

module.exports = {
  createHeartbeat,
}
