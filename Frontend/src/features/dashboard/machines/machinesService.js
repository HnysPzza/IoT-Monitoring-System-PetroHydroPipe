import { apiRequest } from '../../../shared/services/apiClient.js'

export function getMachines(token, signal) {
  return apiRequest('/api/machines', { token, signal })
}
