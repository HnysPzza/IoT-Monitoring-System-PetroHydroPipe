function isDowntimeAlert(alert) {
  return Boolean(alert?.metadata?.downtimeId)
}

export function getAlertKind(alert) {
  if (alert?.metadata?.processFault) return { label: 'Sensor fault', className: 'is-sensor-fault' }
  if (isDowntimeAlert(alert)) return { label: 'Downtime', className: 'is-downtime' }
  return null
}

export function getAlertDestination(alert) {
  return isDowntimeAlert(alert) && !alert?.metadata?.processFault
    ? { to: '/dashboard/downtime', label: 'View downtime records' }
    : { to: '/dashboard/live', label: 'View live sensor status' }
}
