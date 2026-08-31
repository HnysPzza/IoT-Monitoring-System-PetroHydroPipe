import { apiRequest } from '../../../shared/services/apiClient.js'

export function getOperationalSettings(token, machineId) {
  return apiRequest(`/api/machines/${machineId}/settings`, { token })
}

export function updateOperationalSettings(token, machineId, settings) {
  return apiRequest(`/api/machines/${machineId}/settings`, {
    token,
    method: 'PATCH',
    body: settings,
  })
}

export function getWatchdogDiagnostics(token) {
  return apiRequest('/api/operations/watchdog', { token })
}
