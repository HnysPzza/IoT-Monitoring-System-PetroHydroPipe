import { apiRequest } from '../../../shared/services/apiClient.js'

export function getDashboardOverview(token, { trendMode, date } = {}) {
  const params = new URLSearchParams()
  const normalizedDate = trendMode === 'month' && date?.length === 7 ? `${date}-01` : date

  if (trendMode) params.set('trendMode', trendMode)
  if (normalizedDate) params.set('date', normalizedDate)

  const queryString = params.toString()
  return apiRequest(`/api/dashboard/overview${queryString ? `?${queryString}` : ''}`, { token })
}

export function getDashboardDowntimeImpact(token, { trendMode, date } = {}) {
  const params = new URLSearchParams()
  const normalizedDate = trendMode === 'month' && date?.length === 7 ? `${date}-01` : date

  if (trendMode) params.set('trendMode', trendMode)
  if (normalizedDate) params.set('date', normalizedDate)

  const queryString = params.toString()
  return apiRequest(`/api/dashboard/downtime-impact${queryString ? `?${queryString}` : ''}`, { token })
}
