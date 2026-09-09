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

test('sensor event timestamps accept explicit UTC offsets like heartbeat timestamps', () => {
  for (const recordedAt of ['2026-09-09T08:00:00+08:00', '2026-09-09T00:00:00Z']) {
    const input = event('downtime', 'no_pulse')
    input.body.recordedAt = recordedAt
    assert.equal(sensorEventSchema.safeParse(input).success, true, recordedAt)
  }
  const input = event('downtime', 'no_pulse')
  input.body.recordedAt = '2026-09-09T08:00:00'
  assert.equal(sensorEventSchema.safeParse(input).success, false)
})

test('every mismatched event and signal pair is rejected', () => {
  const pairs = { pulse: 'active', idle: 'idle', downtime: 'no_pulse', fault: 'fault', recovered: 'active' }
  for (const [type, expected] of Object.entries(pairs)) {
    for (const signal of ['active', 'idle', 'no_pulse', 'fault']) {
      assert.equal(sensorEventSchema.safeParse(event(type, signal)).success, signal === expected, `${type}/${signal}`)
    }
  }
})
