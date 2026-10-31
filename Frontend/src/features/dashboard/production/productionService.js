import { apiRequest } from '../../../shared/services/apiClient.js'

export function normalizeProductionRecord(record = {}) {
  const customer =
    record.customer !== undefined && record.customer !== null
      ? String(record.customer).trim() || null
      : null

  const diameter =
    record.diameter !== undefined && record.diameter !== null && record.diameter !== ''
      ? Number(record.diameter)
      : null

  const thickness =
    record.thickness !== undefined && record.thickness !== null && record.thickness !== ''
      ? Number(record.thickness)
      : null

  const length =
    record.length !== undefined && record.length !== null && record.length !== ''
      ? Number(record.length)
      : null

  const rawPipe = record.pipeNumber !== undefined ? record.pipeNumber : record.pipe_number
  const pipeNumber =
    rawPipe !== undefined && rawPipe !== null && rawPipe !== '' && !isNaN(Number(rawPipe))
      ? parseInt(rawPipe, 10)
      : null

  const tonnage =
    record.tonnage !== undefined && record.tonnage !== null && record.tonnage !== ''
      ? Number(record.tonnage)
      : null

  return {
    ...record,
    customer,
    diameter: Number.isFinite(diameter) ? diameter : null,
    thickness: Number.isFinite(thickness) ? thickness : null,
    length: Number.isFinite(length) ? length : null,
    pipeNumber: Number.isFinite(pipeNumber) ? pipeNumber : null,
    tonnage: Number.isFinite(tonnage) ? tonnage : null,
  }
}

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

  const payload = await apiRequest(path, {
    token,
    signal: filters.signal,
  })

  if (payload && Array.isArray(payload.records)) {
    return {
      ...payload,
      records: payload.records.map(normalizeProductionRecord),
    }
  }

  return payload
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

  const sanitizeInteger = (val) => {
    if (val === undefined || val === null || val === '') return null
    const num = parseInt(val, 10)
    return isNaN(num) ? null : num
  }

  const concurrencyToken = expectedUpdatedAt !== undefined ? expectedUpdatedAt : spec.expectedUpdatedAt

  const rawPipe = spec.pipeNumber !== undefined ? spec.pipeNumber : spec.pipe_number
  const body = {
    customer: sanitizeText(spec.customer),
    diameter: sanitizeNumber(spec.diameter),
    thickness: sanitizeNumber(spec.thickness),
    length: sanitizeNumber(spec.length),
    pipeNumber: sanitizeInteger(rawPipe),
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
  const rawCustomer = spec.customer !== undefined ? spec.customer : arguments[1]?.customer
  const rawDiameter = spec.diameter !== undefined ? spec.diameter : arguments[1]?.diameter
  const rawThickness = spec.thickness !== undefined ? spec.thickness : arguments[1]?.thickness
  const rawLength = spec.length !== undefined ? spec.length : arguments[1]?.length

  const cleanCustomer = sanitizeText(rawCustomer)
  if (cleanCustomer !== undefined) body.customer = cleanCustomer

  const cleanDiameter = sanitizeNumber(rawDiameter)
  if (cleanDiameter !== undefined) body.diameter = cleanDiameter

  const cleanThickness = sanitizeNumber(rawThickness)
  if (cleanThickness !== undefined) body.thickness = cleanThickness

  const cleanLength = sanitizeNumber(rawLength)
  if (cleanLength !== undefined) body.length = cleanLength

  return apiRequest('/api/production/batch', {
    token,
    method: 'PATCH',
    body,
  })
}

