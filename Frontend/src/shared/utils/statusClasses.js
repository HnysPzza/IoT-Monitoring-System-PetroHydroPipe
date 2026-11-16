export function getMachineStatusClass(status) {
  if (status === 'Offline' || (typeof status === 'string' && status.startsWith('Last:'))) return 'status-offline'
  if (status === 'Running') return 'status-running'
  if (status === 'Downtime') return 'status-downtime'
  if (status === 'Fault') return 'status-fault'
  if (status === 'Unavailable') return 'status-unavailable'
  return 'status-idle'
}

export function getLiveStatusClass(status) {
  return getMachineStatusClass(status)
}

export function getSensorStatusClass(status) {
  if (status === 'Offline' || (typeof status === 'string' && status.startsWith('Last:'))) return 'status-offline'
  if (status === 'Active' || status === 'Running') return 'status-running'
  if (status === 'Downtime') return 'status-downtime'
  if (status === 'Fault') return 'status-fault'
  if (status === 'Idle') return 'status-idle'
  return 'status-unavailable'
}

export function getDowntimeStatusClass(status) {
  return status === 'Open' ? 'status-downtime' : 'status-active'
}

export function getAccountStatusClass(status) {
  return status === 'Active' ? 'status-active' : 'status-inactive'
}
