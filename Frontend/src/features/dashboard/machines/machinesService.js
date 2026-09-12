import { apiRequest } from '../../../shared/services/apiClient.js'

export function getMachines(token) {
  return apiRequest('/api/machines', { token })
}
