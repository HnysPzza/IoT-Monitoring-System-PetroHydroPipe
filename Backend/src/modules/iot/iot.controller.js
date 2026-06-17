const iotService = require('./iot.service')

async function createSensorEvent(req, res) {
  const event = await iotService.createSensorEvent({
    deviceId: req.get('x-device-id'),
    deviceKey: req.get('x-device-key'),
    payload: req.validated.body,
  })

  res.status(201).json({ event })
}

async function getLiveFeed(req, res) {
  const liveFeed = await iotService.getLiveFeed()
  res.json(liveFeed)
}

module.exports = {
  createSensorEvent,
  getLiveFeed,
}
