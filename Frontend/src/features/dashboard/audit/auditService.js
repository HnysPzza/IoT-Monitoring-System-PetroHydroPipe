import { apiRequest } from '../../../shared/services/apiClient.js'

function buildAuditQuery(filters) {
  const params = new URLSearchParams()

  if (filters.action && filters.action !== 'All') {
    params.set('action', filters.action)
  }

  if (filters.entityType && filters.entityType !== 'All') {
    params.set('entityType', filters.entityType)
  }

  if (filters.dateFrom && filters.dateTo) {
    params.set('dateFrom', filters.dateFrom)
    params.set('dateTo', filters.dateTo)
  } else if (filters.dateFrom) {
    params.set('dateFrom', filters.dateFrom)
  } else if (filters.dateTo) {
    params.set('dateTo', filters.dateTo)
  } else if (filters.date) {
    params.set('dateFrom', filters.date)
    params.set('dateTo', filters.date)
  }

  if (filters.page) {
    params.set('page', filters.page)
  }

  if (filters.limit) {
    params.set('limit', filters.limit)
  }

  const queryString = params.toString()
  return queryString ? `?${queryString}` : ''
}

export function getAuditLogs(token, filters) {
  return apiRequest(`/api/audit${buildAuditQuery(filters)}`, { token })
}
