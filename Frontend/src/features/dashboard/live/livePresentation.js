import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'

const PROCESS_SENSOR_CODES = new Set(['S-01', 'S-02', 'S-04'])

export function connectivityLabel(sensor) {
  if (sensor.monitoring?.connectivityState === 'online') return 'Connected'
  if (sensor.monitoring?.connectivityState === 'offline') return 'Offline'
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

  if (sensor.sensorCode === 'S-05') {
    const safeStatus = operationalStatus === 'Fault' || operationalStatus === 'Downtime'
      ? 'Running'
      : operationalStatus
    return { ...result, displayStatus: safeStatus, stateLabel: 'Production output sensing' }
  }
  if (operationalStatus === 'Downtime') {
    return { ...result, stateLabel: 'Confirmed operational downtime' }
  }
  if (operationalStatus === 'Fault') {
    return { ...result, stateLabel: 'Process sensor fault' }
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

export function getProcessSensorFaultBanner(sensors = [], mode = 'unknown') {
  if (!Array.isArray(sensors) || sensors.length === 0) return null

  const presented = sensors.map((sensor) => (
    sensor.displayStatus ? sensor : presentLiveSensor(sensor, mode)
  ))

  const downtimeSensors = presented.filter((sensor) => (
    sensor.displayStatus === 'Downtime' || sensor.status === 'Downtime'
  ))
  const faultSensors = presented.filter((sensor) => (
    sensor.displayStatus === 'Fault' || sensor.status === 'Fault'
  ))

  const issueSensors = [...downtimeSensors, ...faultSensors]
  if (issueSensors.length === 0) return null

  const primary = issueSensors[0]
  const label = getSensorLabel(primary.sensorCode, primary.label)
  const isDowntime = primary.displayStatus === 'Downtime' || primary.status === 'Downtime'

  return {
    sensorCode: primary.sensorCode,
    label,
    extraCount: issueSensors.length - 1,
    isDowntime,
    message: isDowntime
      ? `${primary.sensorCode} ${label} downtime detected.`
      : `${primary.sensorCode} ${label} process issue detected — trigger limit exceeded.`,
  }
}

export function getProcessIdleBanner(sensors = [], mode = 'unknown') {
  if (!Array.isArray(sensors) || sensors.length === 0) return null

  const presented = sensors.map((sensor) => (
    sensor.displayStatus ? sensor : presentLiveSensor(sensor, mode)
  ))

  const idleSensors = presented
    .filter((sensor) => PROCESS_SENSOR_CODES.has(sensor.sensorCode) && sensor.displayStatus === 'Idle')
    .map((sensor) => ({
      sensorCode: sensor.sensorCode,
      label: getSensorLabel(sensor.sensorCode, sensor.label),
    }))

  if (idleSensors.length === 0) return null

  const primary = idleSensors[0]
  return {
    sensors: idleSensors,
    primary,
    extraCount: idleSensors.length - 1,
    message: `${primary.sensorCode} ${primary.label} is idle — within trigger limit for material changeover.`,
  }
}
