import { apiRequest } from '../../../shared/services/apiClient.js'

export function getMachines(token) {
  return apiRequest('/api/machines', { token })
}

export function getMachineSensors(token, machineId) {
  return apiRequest(`/api/machines/${machineId}/sensors`, { token })
}

export function updateMachineStatus(token, machineId, status) {
  return apiRequest(`/api/machines/${machineId}/status`, {
    token,
    method: 'PATCH',
    body: { status },
  })
}

export function updateSensorStatus(token, sensorId, status, overrideReason) {
  return apiRequest(`/api/machines/sensors/${sensorId}/status`, {
    token,
    method: 'PATCH',
    body: overrideReason ? { status, overrideReason } : { status },
  })
}
