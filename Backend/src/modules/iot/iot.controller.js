const iotService = require('./iot.service')

async function createSensorEvent(req, res) {
  const event = await iotService.createSensorEvent({
    sensor: req.iotDevice,
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
