const OUTPUT_SENSOR_CODE = 'S-05'

const sensorIdentities = {
  'S-01': {
    label: 'Raw Material Detection',
    purpose: 'Detects raw material movement into the production line.',
  },
  'S-02': {
    label: 'Outside Filler',
    purpose: 'Monitors outside filler activity during pipe production.',
  },
  'S-03': {
    label: 'Coil Joint',
    purpose: 'Detects coil joint replacement activity.',
  },
  'S-04': {
    label: 'Inside Filler',
    purpose: 'Monitors inside filler activity during pipe production.',
  },
  'S-05': {
    label: 'Production Output Cutting',
    purpose: 'Counts output cutting events at the end of the production line.',
  },
}

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
