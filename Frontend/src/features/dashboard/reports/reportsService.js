import { apiRequest } from '../../../shared/services/apiClient.js'

export const reportTypes = [
  { id: 'daily', label: 'Daily summary' },
  { id: 'weekly', label: 'Weekly summary' },
  { id: 'monthly', label: 'Monthly summary' },
]

export function getReportSummary(token, { reportType, selectedDate }) {
  const params = new URLSearchParams()
  const normalizedDate = selectedDate?.length === 7 ? `${selectedDate}-01` : selectedDate

  params.set('type', reportType)
  if (normalizedDate) params.set('date', normalizedDate)

  return apiRequest(`/api/reports/summary?${params.toString()}`, { token })
}
