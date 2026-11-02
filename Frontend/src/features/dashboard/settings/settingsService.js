import { apiRequest } from '../../../shared/services/apiClient.js'

export function getOperationalSettings(token, machineId, signal) {
  return apiRequest(`/api/machines/${machineId}/settings`, { token, signal })
}

export function updateOperationalSettings(token, machineId, settings) {
  return apiRequest(`/api/machines/${machineId}/settings`, {
    token,
    method: 'PATCH',
    body: settings,
  })
}

export function getWatchdogDiagnostics(token, signal) {
  return apiRequest('/api/operations/watchdog', { token, signal })
}
