export const sensorIdentities = [
  {
    code: 'S-01',
    label: 'Raw Material Detection',
    purpose: 'Detects raw material movement into the production line.',
  },
  {
    code: 'S-02',
    label: 'Outside Filler',
    purpose: 'Monitors outside filler activity during pipe production.',
  },
  {
    code: 'S-03',
    label: 'Coil Joint',
    purpose: 'Detects coil joint replacement activity.',
  },
  {
    code: 'S-04',
    label: 'Inside Filler',
    purpose: 'Monitors inside filler activity during pipe production.',
  },
  {
    code: 'S-05',
    label: 'Production Output Cutting',
    purpose: 'Counts output cutting events at the end of the production line.',
  },
]

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
