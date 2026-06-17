import { apiRequest } from '../../../shared/services/apiClient.js'

export function getDowntimeRecords(token, filters = {}) {
  const params = new URLSearchParams()

  if (filters.status && filters.status !== 'All') params.set('status', filters.status)
  if (filters.cause && filters.cause !== 'All') params.set('cause', filters.cause)
  if (filters.date) params.set('date', filters.date)

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
