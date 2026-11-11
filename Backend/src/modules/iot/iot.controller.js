const iotService = require('./iot.service')

function applyDeviceThresholdHeaders(res, thresholds) {
  if (!thresholds) return
  if (typeof thresholds.absenceDetectionEnabled === 'boolean') {
    res.set('x-absence-enabled', thresholds.absenceDetectionEnabled ? 'true' : 'false')
  }
  if (Number.isInteger(thresholds.triggerSeconds) && thresholds.triggerSeconds > 0) {
    res.set('x-trigger-seconds', String(thresholds.triggerSeconds))
  }
  if (Number.isInteger(thresholds.recoverySeconds) && thresholds.recoverySeconds > 0) {
    res.set('x-recovery-seconds', String(thresholds.recoverySeconds))
  }
  if (Number.isInteger(thresholds.rotationStallMs) && thresholds.rotationStallMs > 0) {
    res.set('x-rotation-stall-ms', String(thresholds.rotationStallMs))
  }
  if (thresholds.version) {
    res.set('x-settings-version', String(thresholds.version))
  }
}

async function createSensorEvent(req, res) {
  const [event, thresholds] = await Promise.all([
    iotService.createSensorEvent({
      sensor: req.iotDevice,
      payload: req.validated.body,
    }),
    typeof iotService.getDeviceOperationalThresholds === 'function'
      ? iotService.getDeviceOperationalThresholds(req.iotDevice, { useCache: true })
      : null,
  ])

  applyDeviceThresholdHeaders(res, thresholds)
  res.status(201).json({ event })
}

async function getDeviceConfig(req, res) {
  const thresholds = typeof iotService.getDeviceOperationalThresholds === 'function'
    ? await iotService.getDeviceOperationalThresholds(req.iotDevice)
    : null

  applyDeviceThresholdHeaders(res, thresholds)
  res.set('Cache-Control', 'no-store')
  res.status(200).json({
    config: thresholds || {
      sensorCode: req.iotDevice?.sensor_code || null,
      machineCode: req.iotDevice?.machines?.machine_code || null,
      version: null,
      absenceDetectionEnabled: false,
      triggerSeconds: null,
      recoverySeconds: null,
      ...(req.iotDevice?.sensor_code === 'S-03' ? { rotationStallMs: 3000 } : {}),
    },
  })
}

async function getLiveFeed(req, res) {
  const liveFeed = await iotService.getLiveFeed()
  res.set('Cache-Control', 'no-store')
  res.json(liveFeed)
}

module.exports = {
  applyDeviceThresholdHeaders,
  createSensorEvent,
  getDeviceConfig,
  getLiveFeed,
}
