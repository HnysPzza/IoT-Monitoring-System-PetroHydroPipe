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

export async function updateProductionLogSpec(token, eventId, spec = {}, expectedUpdatedAt) {
  const sanitizeText = (val) => {
    if (val === undefined || val === null) return null
    const trimmed = String(val).trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const sanitizeNumber = (val) => {
    if (val === undefined || val === null || val === '') return null
    const num = Number(val)
    return isNaN(num) ? null : num
  }

  const concurrencyToken = expectedUpdatedAt !== undefined ? expectedUpdatedAt : spec.expectedUpdatedAt

  const body = {
    label: sanitizeText(spec.label),
    size: sanitizeText(spec.size),
    diameter: sanitizeNumber(spec.diameter),
    radius: sanitizeNumber(spec.radius),
    circumference: sanitizeNumber(spec.circumference),
  }

  if (concurrencyToken !== undefined) {
    body.expectedUpdatedAt = concurrencyToken
  }

  return apiRequest(`/api/production/${eventId}`, {
    token,
    method: 'PATCH',
    body,
  })
}

export async function batchUpdateProductionSpecs(
  token,
  { sensorEventIds, appliedSpec = {}, onlyUnlabeled, date, dateFrom, dateTo } = {},
) {
  const sanitizeText = (val) => {
    if (val === undefined || val === null) return undefined
    const trimmed = String(val).trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const sanitizeNumber = (val) => {
    if (val === undefined || val === null || val === '') return undefined
    const num = Number(val)
    return isNaN(num) ? undefined : num
  }

  const body = {}

  if (Array.isArray(sensorEventIds) && sensorEventIds.length > 0) {
    body.sensorEventIds = sensorEventIds
  } else if (dateFrom && dateTo) {
    body.dateFrom = dateFrom
    body.dateTo = dateTo
  } else if (date) {
    body.dateFrom = date
    body.dateTo = date
  }

  if (onlyUnlabeled !== undefined) {
    body.onlyUnlabeled = Boolean(onlyUnlabeled)
  }

  const spec = appliedSpec || {}
  const rawLabel = spec.label !== undefined ? spec.label : arguments[1]?.label
  const rawSize = spec.size !== undefined ? spec.size : arguments[1]?.size
  const rawDiameter = spec.diameter !== undefined ? spec.diameter : arguments[1]?.diameter
  const rawRadius = spec.radius !== undefined ? spec.radius : arguments[1]?.radius
  const rawCircumference = spec.circumference !== undefined ? spec.circumference : arguments[1]?.circumference

  const cleanLabel = sanitizeText(rawLabel)
  if (cleanLabel !== undefined) body.label = cleanLabel

  const cleanSize = sanitizeText(rawSize)
  if (cleanSize !== undefined) body.size = cleanSize

  const cleanDiameter = sanitizeNumber(rawDiameter)
  if (cleanDiameter !== undefined) body.diameter = cleanDiameter

  const cleanRadius = sanitizeNumber(rawRadius)
  if (cleanRadius !== undefined) body.radius = cleanRadius

  const cleanCircumference = sanitizeNumber(rawCircumference)
  if (cleanCircumference !== undefined) body.circumference = cleanCircumference

  return apiRequest('/api/production/batch', {
    token,
    method: 'PATCH',
    body,
  })
}

