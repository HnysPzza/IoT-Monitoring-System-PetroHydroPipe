const assert = require('node:assert/strict')
const test = require('node:test')

const shouldRunIntegration = process.env.RUN_SUPABASE_INTEGRATION_TESTS === 'true'

test('Supabase schema and seed data are readable', { skip: shouldRunIntegration ? false : 'Set RUN_SUPABASE_INTEGRATION_TESTS=true to run read-only Supabase checks.' }, async () => {
  const { getSupabaseClient } = require('../../src/database/client')
  const supabase = getSupabaseClient()

  const { data: roles, error: rolesError } = await supabase
    .from('roles')
    .select('name')

  assert.ifError(rolesError)
  assert.deepEqual(
    roles.map((role) => role.name).sort(),
    ['Admin', 'Asst. Operation Manager', 'Engineering Supervisor', 'Operation Manager', 'Production Supervisor'].sort(),
  )

  const { data: machines, error: machinesError } = await supabase
    .from('machines')
    .select('id, machine_code, name')
    .eq('machine_code', 'M-01')

  assert.ifError(machinesError)
  assert.equal(machines.length, 1)
  assert.equal(machines[0].name, 'Spiral Mill 01')

  const { data: sensors, error: sensorsError } = await supabase
    .from('sensors')
    .select('sensor_code, label, esp32_device_id, device_key_hash')
    .order('sensor_code', { ascending: true })

  assert.ifError(sensorsError)
  assert.equal(sensors.length, 5)
  const registry = require('../../src/shared/sensor-registry.json')
  const expectedSensors = registry.sensors.map((s) => `${s.code}:${s.label}`)
  assert.deepEqual(
    sensors.map((sensor) => `${sensor.sensor_code}:${sensor.label}`),
    expectedSensors,
  )
  assert.ok(sensors.every((sensor) => sensor.esp32_device_id && sensor.device_key_hash))

  const { error: downtimeError } = await supabase
    .from('downtime_events')
    .select('id, sensor_id')
    .limit(1)

  assert.ifError(downtimeError)

  const { error: auditError } = await supabase
    .from('audit_logs')
    .select('id, action, created_at')
    .limit(1)

  assert.ifError(auditError)
})
