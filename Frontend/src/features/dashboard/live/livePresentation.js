import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'

const PROCESS_SENSOR_CODES = new Set(['S-01', 'S-02', 'S-04'])

function formatOfflineDisplayStatus(status) {
  if (typeof status === 'string' && status.startsWith('Last:')) {
    return status
  }

  if (status === 'Running') {
    return 'Last: Run'
  }

  return `Last: ${status || 'Run'}`
}

export function summarizeSensorStatuses(sensors = []) {
  const summary = {
    total: 0,
    running: 0,
    idle: 0,
    fault: 0,
    downtime: 0,
    offline: 0,
    unavailable: 0,
  }

  if (!Array.isArray(sensors)) {
    return summary
  }

  summary.total = sensors.length
  for (const sensor of sensors) {
    const status = sensor.displayStatus || sensor.operationalStatus || sensor.status
    const isOffline = sensor.monitoring?.connectivityState === 'offline'
      || (typeof status === 'string' && status.startsWith('Last:'))

    if (isOffline) {
      summary.offline += 1
    } else if (status === 'Running' || status === 'Active') {
      summary.running += 1
    } else if (status === 'Idle') {
      summary.idle += 1
    } else if (status === 'Fault') {
      summary.fault += 1
    } else if (status === 'Downtime') {
      summary.downtime += 1
    } else {
      summary.unavailable += 1
    }
  }

  return summary
}

export function formatSensorStatusSummary(sensorsOrSummary) {
  const summary = Array.isArray(sensorsOrSummary)
    ? summarizeSensorStatuses(sensorsOrSummary)
    : (sensorsOrSummary || summarizeSensorStatuses([]))

  const parts = [`${summary.running || 0} running`]
  if (summary.idle > 0) parts.push(`${summary.idle} idle`)
  if (summary.fault > 0) parts.push(`${summary.fault} fault`)
  if (summary.downtime > 0) parts.push(`${summary.downtime} downtime`)
  if (summary.offline > 0) parts.push(`${summary.offline} offline`)
  if (summary.unavailable > 0) parts.push(`${summary.unavailable} unavailable`)
  return parts.join(' · ')
}

export function connectivityLabel(sensor) {
  if (sensor.monitoring?.connectivityState === 'online') return 'Connected'
  if (sensor.monitoring?.connectivityState === 'offline') return 'Offline'
  return 'Unavailable'
}

export function presentLiveSensor(sensor, mode) {
  const operationalStatus = sensor.operationalStatus ?? sensor.status
  const monitoring = sensor.monitoring || {}
  const effectiveStatus = sensor.sensorCode === 'S-05' && (operationalStatus === 'Fault' || operationalStatus === 'Downtime')
    ? 'Running'
    : operationalStatus
  const result = {
    ...sensor,
    operationalStatus,
    displayStatus: effectiveStatus,
    stateLabel: 'Operational state',
    connectivityLabel: connectivityLabel(sensor),
  }

  if (monitoring.connectivityState === 'offline') {
    return {
      ...result,
      displayStatus: formatOfflineDisplayStatus(effectiveStatus),
      stateLabel: 'Last run telemetry before disconnect',
    }
  }

  if (sensor.sensorCode === 'S-05') {
    return { ...result, displayStatus: effectiveStatus, stateLabel: 'Production output sensing' }
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
    sensor.sensorCode !== 'S-05'
    && (sensor.displayStatus === 'Downtime' || sensor.operationalStatus === 'Downtime' || sensor.status === 'Downtime')
  ))
  const faultSensors = presented.filter((sensor) => (
    sensor.sensorCode !== 'S-05'
    && (sensor.displayStatus === 'Fault' || sensor.operationalStatus === 'Fault' || sensor.status === 'Fault')
  ))

  const issueSensors = [...downtimeSensors, ...faultSensors]
  if (issueSensors.length === 0) return null

  const primary = issueSensors[0]
  const label = getSensorLabel(primary.sensorCode, primary.label)
  const isDowntime = primary.displayStatus === 'Downtime'
    || primary.operationalStatus === 'Downtime'
    || primary.status === 'Downtime'

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
    message: `${primary.sensorCode} ${primary.label} is idle.`,
  }
}
