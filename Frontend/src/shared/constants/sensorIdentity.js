import registry from './sensor-registry.json'

export const sensorIdentities = registry.sensors.map(({ code, label, purpose }) => ({
  code,
  label,
  purpose,
}))

export const sensorIdentityByCode = Object.fromEntries(
  sensorIdentities.map((sensor) => [sensor.code, sensor]),
)

export function getSensorIdentity(sensorCode) {
  return sensorIdentityByCode[sensorCode] || null
}

export function getSensorLabel(sensorCode, fallback = 'Sensor') {
  return getSensorIdentity(sensorCode)?.label || fallback
}

export function getSensorPurpose(sensorCode, fallback = 'Monitoring point for Spiral Mill 01.') {
  return getSensorIdentity(sensorCode)?.purpose || fallback
}

export function formatSensorName(sensorCode) {
  const identity = getSensorIdentity(sensorCode)
  return identity ? `${identity.code} - ${identity.label}` : sensorCode
}
