import { apiRequest } from '../../../shared/services/apiClient.js'
import { subscribeToServerEvents } from '../../../shared/services/eventStream.js'

export function getAlerts(token, { signal } = {}) {
  return apiRequest('/api/alerts', { token, signal })
}

export function acknowledgeAlert(token, alertId) {
  return apiRequest(`/api/alerts/${alertId}/acknowledge`, {
    token,
    method: 'PATCH',
    fallbackError: 'Unable to acknowledge alert.',
  })
}

export function subscribeToAlerts(token, handlers = {}) {
  return subscribeToServerEvents('/api/alerts/stream', token, handlers)
}
