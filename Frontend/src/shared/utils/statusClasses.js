export function getMachineStatusClass(status) {
  if (status === 'Running') return 'status-running'
  if (status === 'Downtime') return 'status-downtime'
  return 'status-idle'
}

export function getLiveStatusClass(status) {
  if (status === 'Fault') return 'status-downtime'
  return getMachineStatusClass(status)
}

export function getSensorStatusClass(status) {
  if (status === 'Active') return 'status-running'
  if (status === 'Fault') return 'status-downtime'
  return 'status-idle'
}

export function getDowntimeStatusClass(status) {
  return status === 'Open' ? 'status-downtime' : 'status-active'
}

export function getAccountStatusClass(status) {
  return status === 'Active' ? 'status-active' : 'status-inactive'
}
