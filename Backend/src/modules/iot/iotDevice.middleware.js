const iotService = require('./iot.service')

async function authenticateIotDevice(req, res, next) {
  const headers = req.validated.headers

  const device = await iotService.authenticateDevice({
    deviceId: headers['x-device-id'],
    deviceKey: headers['x-device-key'],
  })

  if (!device?.id) {
    const error = new Error('Authenticated IoT device is missing a stable identifier.')
    error.status = 500
    error.code = 'IOT_DEVICE_ID_MISSING'
    throw error
  }

  const { device_key_hash: _deviceKeyHash, ...verifiedDevice } = device
  req.iotDevice = verifiedDevice
  return next()
}

module.exports = authenticateIotDevice
