const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('../helpers/appTestUtils')
const {
  shiftScheduleSchema,
  storedSettingsRecordSchema,
} = require('../../src/modules/settings/settings.model')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const userId = '11111111-1111-4111-8111-111111111111'
const machineId = '22222222-2222-4222-8222-222222222222'

function authHeader(role = 'Admin') {
  const token = jwt.sign(
    { username: role.toLowerCase().replaceAll(' ', ''), role },
    JWT_SECRET,
    { subject: userId, expiresIn: '1h' },
  )
  return { Authorization: `Bearer ${token}` }
}

function validScheduleWithoutRestDays() {
  return {
    workStart: '08:00',
    workEnd: '17:00',
    breaks: [
      { name: 'Morning Break', startTime: '10:00', endTime: '10:15' },
      { name: 'Lunch Break', startTime: '12:00', endTime: '13:00' },
      { name: 'Afternoon Break', startTime: '15:00', endTime: '15:15' },
    ],
    rampUpGraceMinutes: 10,
  }
}

test('historical shift_schedule records without restDays parse as restDays: []', () => {
  const parsedSchedule = shiftScheduleSchema.safeParse(validScheduleWithoutRestDays())
  assert.equal(parsedSchedule.success, true)
  assert.deepEqual(parsedSchedule.data.restDays, [])

  const parsedStored = storedSettingsRecordSchema.safeParse({
    machine_id: machineId,
    sensor_thresholds: {
      'S-01': { absenceDetectionEnabled: false, triggerSeconds: 600, recoverySeconds: null },
      'S-02': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
      'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null, rotationStallMs: 3000 },
      'S-04': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
      'S-05': { absenceDetectionEnabled: false, triggerSeconds: null, recoverySeconds: null },
    },
    shift_schedule: validScheduleWithoutRestDays(),
    version: '1',
    updated_at: '2026-11-15T00:00:00.000Z',
    updated_by: null,
  })
  assert.equal(parsedStored.success, true)
  assert.deepEqual(parsedStored.data.shift_schedule.restDays, [])
})

test('PATCH /api/machines/:machineId/settings accepts valid restDays and rejects 7 weekdays, invalid names, or duplicates with 400', async () => {
  const calls = []
  const app = loadAppWithMocks({
    'src/modules/settings/settings.service.js': {
      getSettingsConstraints: () => ({}),
      getMachineSettingsForRead: async () => ({}),
      updateMachineSettings: async (values) => {
        calls.push(values)
        return {
          machineId,
          timeZone: 'Asia/Manila',
          sensorThresholds: {},
          shiftSchedule: values.shiftSchedule,
          version: '2',
          updatedAt: '2026-11-16T02:00:00.000Z',
          updatedBy: userId,
        }
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const validResponse = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        expectedVersion: '1',
        shiftSchedule: {
          ...validScheduleWithoutRestDays(),
          restDays: ['sunday'],
        },
      },
    })
    assert.equal(validResponse.response.status, 200)
    assert.deepEqual(validResponse.body.settings.shiftSchedule.restDays, ['sunday'])
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].shiftSchedule.restDays, ['sunday'])

    const defaultRestDaysResponse = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        expectedVersion: '2',
        shiftSchedule: validScheduleWithoutRestDays(),
      },
    })
    assert.equal(defaultRestDaysResponse.response.status, 200)
    assert.deepEqual(calls[1].shiftSchedule.restDays, [])

    const invalidRestDaysPayloads = [
      ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      ['funday'],
      ['Sunday'],
      ['sunday', 'sunday'],
    ]

    for (const restDays of invalidRestDaysPayloads) {
      const invalidResponse = await requestJson(baseUrl, `/api/machines/${machineId}/settings`, {
        method: 'PATCH',
        headers: authHeader('Admin'),
        body: {
          expectedVersion: '2',
          shiftSchedule: {
            ...validScheduleWithoutRestDays(),
            restDays,
          },
        },
      })
      assert.equal(invalidResponse.response.status, 400)
      assertError(invalidResponse.body, 'VALIDATION_ERROR')
    }
    assert.equal(calls.length, 2)
  })
})
