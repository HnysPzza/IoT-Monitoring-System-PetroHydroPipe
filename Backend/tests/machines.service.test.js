const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const SENSOR_ID = '40000000-0000-4000-8000-000000000004'
const USER_ID = '20000000-0000-4000-8000-000000000002'

function clearSourceCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) delete require.cache[cacheKey]
  })
}

function mockModule(relativePath, exportsValue) {
  const modulePath = path.join(backendRoot, relativePath)
  require.cache[require.resolve(modulePath)] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  }
}

test('manual sensor recovery uses one RPC and publishes committed downtime and alert transitions', async () => {
  clearSourceCache()
  const rpcCalls = []
  const published = []
  mockModule('src/database/client.js', {
    getSupabaseClient: () => ({
      rpc(functionName, values) {
        rpcCalls.push({ functionName, values })
        return {
          single: async () => ({
            data: {
              sensor_record: {
                id: SENSOR_ID,
                sensor_code: 'S-02',
                esp32_device_id: 'esp32-m01-s02',
                label: 'Inside Filler Wire',
                status: 'Active',
                machine_id: 'machine-1',
              },
              machine_record: {
                id: 'machine-1',
                machine_code: 'M-01',
                name: 'Spiral Mill 01',
                status: 'Running',
                sensor_count: 5,
              },
              downtime_action: 'resolved',
              downtime_id: 'downtime-1',
              alert_action: 'updated',
              alert_record: { id: 'alert-1', status: 'Active', metadata: { recoveryPending: true } },
            },
            error: null,
          }),
        }
      },
    }),
  })
  mockModule('src/modules/audit/audit.service.js', { recordAuditLog: async () => {} })
  mockModule('src/modules/operations/transitionPublisher.js', {
    publishTransitionDescriptors: (descriptors) => published.push(descriptors),
  })
  const machinesService = require('../src/modules/machines/machines.service')

  const result = await machinesService.updateSensorStatus({
    sensorId: SENSOR_ID,
    status: 'Active',
    actorUserId: USER_ID,
    overrideReason: 'Maintenance confirmed normal operation',
  })

  assert.deepEqual(rpcCalls, [{
    functionName: 'override_sensor_recovery',
    values: {
      p_sensor_id: SENSOR_ID,
      p_actor_user_id: USER_ID,
      p_reason: 'Maintenance confirmed normal operation',
    },
  }])
  assert.equal(result.sensor.status, 'Active')
  assert.equal(result.machine.status, 'Running')
  assert.equal(result.machine.sensorCount, 5)
  assert.deepEqual(published[0], [
    { kind: 'downtime', action: 'resolved', id: 'downtime-1', sensorCode: 'S-02', machineCode: 'M-01' },
    { kind: 'alert', action: 'updated', record: { id: 'alert-1', status: 'Active', metadata: { recoveryPending: true } } },
  ])
})

test('machine status cannot bypass a fault or unresolved alert', async () => {
  clearSourceCache()
  let machineUpdated = false
  mockModule('src/database/client.js', {
    getSupabaseClient: () => ({
      from(tableName) {
        return {
          select() { return this },
          eq() {
            if (tableName === 'sensors') {
              return Promise.resolve({ data: [{ status: 'Fault' }], error: null })
            }
            return this
          },
          in() {
            return Promise.resolve({ count: 1, error: null })
          },
          update() {
            machineUpdated = true
            return this
          },
        }
      },
    }),
  })
  mockModule('src/modules/audit/audit.service.js', { recordAuditLog: async () => {} })
  mockModule('src/modules/operations/transitionPublisher.js', { publishTransitionDescriptors: () => 0 })
  const machinesService = require('../src/modules/machines/machines.service')

  await assert.rejects(
    machinesService.updateMachineStatus({ machineId: 'machine-1', status: 'Running', actorUserId: USER_ID }),
    (error) => error.status === 409 && error.code === 'MACHINE_STATUS_CONFLICT',
  )
  assert.equal(machineUpdated, false)
})
