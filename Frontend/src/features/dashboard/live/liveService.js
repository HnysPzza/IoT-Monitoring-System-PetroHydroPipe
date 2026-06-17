import { apiRequest } from '../../../shared/services/apiClient.js'

export function getLiveFeed(token) {
  return apiRequest('/api/iot/live', { token })
}
