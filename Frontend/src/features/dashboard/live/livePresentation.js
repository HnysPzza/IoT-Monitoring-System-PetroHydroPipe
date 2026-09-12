export function connectivityLabel(sensor) {
  if (!sensor.monitoring?.stateFresh) return 'Unavailable'
  if (sensor.monitoring.connectivityState === 'online') return 'Connected'
  if (sensor.monitoring.connectivityState === 'offline') return 'Offline'
  return 'Unavailable'
}

export function presentLiveSensor(sensor, mode) {
  const operationalStatus = sensor.status
  const monitoring = sensor.monitoring || {}
  const result = {
    ...sensor,
    displayStatus: operationalStatus,
    stateLabel: 'Operational state',
    connectivityLabel: connectivityLabel(sensor),
  }

  if (operationalStatus === 'Downtime') {
    return { ...result, stateLabel: 'Confirmed operational downtime' }
  }
  if (operationalStatus === 'Fault') {
    return { ...result, stateLabel: 'Process sensor fault' }
  }
  if (sensor.sensorCode === 'S-05') {
    return { ...result, stateLabel: 'Production output sensing' }
  }
  if (mode === 'disabled') {
    return { ...result, stateLabel: 'Monitoring disabled' }
  }
  if (!monitoring.stateFresh) {
    return { ...result, stateLabel: 'Monitoring data unavailable' }
  }

  if (monitoring.detectionState === 'grace') {
    return { ...result, displayStatus: 'Idle', stateLabel: 'Idle — grace period' }
  }
  if (monitoring.detectionState === 'recovering') {
    return { ...result, displayStatus: 'Idle', stateLabel: 'Monitoring — recovery confirmation' }
  }
  if (monitoring.detectionState === 'downtime') {
    if (mode === 'observe') {
      return { ...result, displayStatus: 'Idle', stateLabel: 'Idle — threshold observed' }
    }
    return { ...result, displayStatus: 'Idle', stateLabel: 'Monitoring — threshold reached' }
  }
  if (monitoring.detectionState === 'suspended') {
    return { ...result, stateLabel: 'Monitoring paused for schedule' }
  }
  if (monitoring.detectionState === 'healthy') {
    return { ...result, stateLabel: 'Pulse detection healthy' }
  }
  return { ...result, stateLabel: 'Absence detection disabled' }
}

export function presentLiveSensors(sensors, mode) {
  return sensors.map((sensor) => presentLiveSensor(sensor, mode))
}
