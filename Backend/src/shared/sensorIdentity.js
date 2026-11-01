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

const PROCESS_SENSOR_CODES = Object.freeze(
  registry.sensors
    .map((sensor) => sensor.code)
    .filter((code) => code !== OUTPUT_SENSOR_CODE && code !== 'S-03'),
)

module.exports = {
  OUTPUT_SENSOR_CODE,
  PROCESS_SENSOR_CODES,
  getSensorIdentity,
  getSensorLabel,
  getSensorPurpose,
  sensorIdentities,
}
