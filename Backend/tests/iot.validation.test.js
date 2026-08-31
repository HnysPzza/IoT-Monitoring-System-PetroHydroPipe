const assert = require('node:assert/strict')
const test = require('node:test')

const { sensorEventSchema } = require('../src/modules/iot/iot.model')

const headers = {
  'x-device-id': 'esp32-m01-s01',
  'x-device-key': 'device-secret',
}

function event(eventType, signal) {
  return {
    headers,
    body: {
      eventId: '11111111-1111-4111-8111-111111111111',
      eventType,
      signal,
    },
  }
}

test('device event contract keeps activity, idle, absence, fault, and recovery distinct', () => {
  const validPairs = [
    ['pulse', 'active'],
    ['idle', 'idle'],
    ['downtime', 'no_pulse'],
    ['fault', 'fault'],
    ['recovered', 'active'],
  ]

  for (const [eventType, signal] of validPairs) {
    assert.equal(sensorEventSchema.safeParse(event(eventType, signal)).success, true)
  }

  assert.equal(sensorEventSchema.safeParse(event('idle', 'no_pulse')).success, false)
  assert.equal(sensorEventSchema.safeParse(event('downtime', 'idle')).success, false)
  assert.equal(sensorEventSchema.safeParse(event('fault', 'no_pulse')).success, false)
})
