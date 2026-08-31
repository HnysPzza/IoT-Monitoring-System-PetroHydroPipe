const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const backendIdentity = require('../../src/shared/sensorIdentity')

test('backend and frontend sensor-registry.json files are identical and authoritative', () => {
  const backendRegistryPath = path.resolve(__dirname, '../../src/shared/sensor-registry.json')
  const frontendRegistryPath = path.resolve(__dirname, '../../../Frontend/src/shared/constants/sensor-registry.json')

  const backendRaw = fs.readFileSync(backendRegistryPath, 'utf8')
  const frontendRaw = fs.readFileSync(frontendRegistryPath, 'utf8')

  const backendJson = JSON.parse(backendRaw)
  const frontendJson = JSON.parse(frontendRaw)

  assert.deepEqual(backendJson, frontendJson, 'Frontend and Backend sensor registries must be identical')
  assert.equal(backendJson.sensors.length, 5)
  assert.equal(backendIdentity.OUTPUT_SENSOR_CODE, 'S-05')

  for (const sensor of backendJson.sensors) {
    assert.equal(backendIdentity.getSensorLabel(sensor.code), sensor.label)
    assert.equal(backendIdentity.getSensorPurpose(sensor.code), sensor.purpose)
  }
})
