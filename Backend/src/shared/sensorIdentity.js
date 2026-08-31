const registry = require('./sensor-registry.json')

const OUTPUT_SENSOR_CODE = registry.outputSensorCode
const sensorIdentities = Object.fromEntries(
  registry.sensors.map((sensor) => [sensor.code, { label: sensor.label, purpose: sensor.purpose }]),
)

function getSensorIdentity(sensorCode) {
  return sensorIdentities[sensorCode] || null
}

function getSensorLabel(sensorCode, fallback = 'Sensor') {
  return getSensorIdentity(sensorCode)?.label || fallback
}

function getSensorPurpose(sensorCode, fallback = 'Monitoring point for Spiral Mill 01.') {
  return getSensorIdentity(sensorCode)?.purpose || fallback
}

module.exports = {
  OUTPUT_SENSOR_CODE,
  getSensorIdentity,
  getSensorLabel,
  getSensorPurpose,
  sensorIdentities,
}
