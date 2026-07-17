import { apiRequest } from '../../../shared/services/apiClient.js'
import { subscribeToServerEvents } from '../../../shared/services/eventStream.js'

export function getDowntimeRecords(token, filters = {}) {
  const params = new URLSearchParams()

  if (filters.status && filters.status !== 'All') params.set('status', filters.status)
  if (filters.cause && filters.cause !== 'All') params.set('cause', filters.cause)
  if (filters.date) params.set('date', filters.date)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))

  const queryString = params.toString()
  return apiRequest(`/api/downtime${queryString ? `?${queryString}` : ''}`, { token })
}

export function updateDowntimeRecord(token, recordId, values) {
  return apiRequest(`/api/downtime/${recordId}`, {
    token,
    method: 'PATCH',
    body: values,
  })
}

export function subscribeToDowntime(token, handlers = {}) {
  return subscribeToServerEvents('/api/downtime/stream', token, handlers)
}
