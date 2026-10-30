import { apiRequest } from '../../../shared/services/apiClient.js'

export async function getProductionLogs(token, filters = {}) {
  const params = new URLSearchParams()

  if (filters.page) {
    params.set('page', String(filters.page))
  }

  if (filters.pageSize) {
    params.set('pageSize', String(filters.pageSize))
  } else if (filters.limit) {
    params.set('limit', String(filters.limit))
  }

  if (filters.date) {
    params.set('date', String(filters.date))
  }

  if (filters.dateFrom) {
    params.set('dateFrom', String(filters.dateFrom))
  }

  if (filters.dateTo) {
    params.set('dateTo', String(filters.dateTo))
  }

  if (filters.status && typeof filters.status === 'string') {
    params.set('status', filters.status)
  }

  if (filters.specStatus && typeof filters.specStatus === 'string') {
    params.set('specStatus', filters.specStatus)
  }

  if (filters.search && typeof filters.search === 'string') {
    const trimmed = filters.search.trim()
    if (trimmed.length > 0) {
      params.set('search', trimmed)
    }
  }

  const queryString = params.toString()
  const path = `/api/production${queryString ? `?${queryString}` : ''}`

  return apiRequest(path, {
    token,
    signal: filters.signal,
  })
}

