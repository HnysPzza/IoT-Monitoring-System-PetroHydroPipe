const assert = require('node:assert/strict')
const test = require('node:test')

const { sensorEventSchema } = require('../src/modules/iot/iot.model')
const { heartbeatSchema } = require('../src/modules/iot/heartbeat.model')

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
  for (const recordedAt of ['2026-05-01T00:00:00+08:00', '2026-04-30T16:00:00Z', '2026-09-09T08:00:00+08:00', '2026-09-09T00:00:00Z']) {
    const input = event('downtime', 'no_pulse')
    input.body.recordedAt = recordedAt
    assert.equal(sensorEventSchema.safeParse(input).success, true, recordedAt)
  }
  const input = event('downtime', 'no_pulse')
  input.body.recordedAt = '2026-09-09T08:00:00'
  assert.equal(sensorEventSchema.safeParse(input).success, false)
})

test('sensor event and heartbeat timestamps reject pre-May-2026 and unsynced epoch clocks', () => {
  for (const invalidRecordedAt of ['1970-01-01T00:00:00Z', '1970-01-01T00:00:00+00:00', '2026-04-30T23:59:59+08:00', '2026-04-30T15:59:59.999Z']) {
    const eventInput = event('pulse', 'active')
    eventInput.body.recordedAt = invalidRecordedAt
    const eventResult = sensorEventSchema.safeParse(eventInput)
    assert.equal(eventResult.success, false, `event should reject ${invalidRecordedAt}`)
    assert.deepEqual(eventResult.error.issues[0].path, ['body', 'recordedAt'])

    const heartbeatResult = heartbeatSchema.safeParse({
      headers,
      body: {
        heartbeatId: '11111111-1111-4111-8111-111111111111',
        bootId: '22222222-2222-4222-8222-222222222222',
        bootCounter: '1',
        sequence: '1',
        recordedAt: invalidRecordedAt,
        activityObserved: true,
      },
    })
    assert.equal(heartbeatResult.success, false, `heartbeat should reject ${invalidRecordedAt}`)
    assert.deepEqual(heartbeatResult.error.issues[0].path, ['body', 'recordedAt'])
  }
})

test('device metadata cannot carry server-owned output classification keys', () => {
  for (const key of ['outputAccepted', 'outputRejectionReason']) {
    const input = event('pulse', 'active')
    input.body.metadata = { [key]: true, firmware: '1.0.0' }
    const result = sensorEventSchema.safeParse(input)
    assert.equal(result.success, false, key)
    assert.deepEqual(result.error.issues[0].path, ['body', 'metadata', key])
  }

  const allowed = event('pulse', 'active')
  allowed.body.metadata = { firmware: '1.0.0' }
  assert.equal(sensorEventSchema.safeParse(allowed).success, true)
})

test('every mismatched event and signal pair is rejected', () => {
  const pairs = { pulse: 'active', idle: 'idle', downtime: 'no_pulse', fault: 'fault', recovered: 'active' }
  for (const [type, expected] of Object.entries(pairs)) {
    for (const signal of ['active', 'idle', 'no_pulse', 'fault']) {
      assert.equal(sensorEventSchema.safeParse(event(type, signal)).success, signal === expected, `${type}/${signal}`)
    }
  }
})
