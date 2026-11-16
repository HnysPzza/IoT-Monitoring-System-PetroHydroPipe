import { apiRequest } from '../../../shared/services/apiClient.js'

async function calendarApiRequest(path, options) {
  try {
    return await apiRequest(path, options)
  } catch (error) {
    if (error && typeof error === 'object' && error.details === undefined && error.payload?.error?.details !== undefined) {
      error.details = error.payload.error.details
    }
    throw error
  }
}

export function getOperationalSettings(token, machineId, signal) {
  return apiRequest(`/api/machines/${machineId}/settings`, { token, signal })
}

export function updateOperationalSettings(token, machineId, settings) {
  return apiRequest(`/api/machines/${machineId}/settings`, {
    token,
    method: 'PATCH',
    body: settings,
  })
}

export function getWatchdogDiagnostics(token, signal) {
  return apiRequest('/api/operations/watchdog', { token, signal })
}

export function getProductionCalendar(token, machineId, rangeOrSignal, maybeSignal) {
  const isSignal = rangeOrSignal && typeof rangeOrSignal === 'object' && 'aborted' in rangeOrSignal
  const range = isSignal ? {} : (rangeOrSignal || {})
  const signal = isSignal ? rangeOrSignal : maybeSignal
  const searchParams = new URLSearchParams()
  if (range.from) searchParams.set('from', range.from)
  if (range.to) searchParams.set('to', range.to)
  const query = searchParams.toString()
  return calendarApiRequest(`/api/machines/${machineId}/calendar${query ? `?${query}` : ''}`, { token, signal })
}

export function setProductionCalendarDay(token, machineId, calendarDateOrPayload, maybePayload) {
  const isObjectCall = typeof calendarDateOrPayload === 'object' && calendarDateOrPayload !== null
  const calendarDate = isObjectCall ? calendarDateOrPayload.calendarDate : calendarDateOrPayload
  let body = maybePayload
  if (isObjectCall) {
    body = { ...calendarDateOrPayload }
    delete body.calendarDate
  }
  return calendarApiRequest(`/api/machines/${machineId}/calendar/days/${calendarDate}`, {
    token,
    method: 'PUT',
    body,
  })
}

export function setProductionCalendarRange(token, machineId, rangePayload) {
  return calendarApiRequest(`/api/machines/${machineId}/calendar/ranges`, {
    token,
    method: 'POST',
    body: rangePayload,
  })
}

export function removeProductionCalendarDay(token, machineId, calendarDate) {
  return calendarApiRequest(`/api/machines/${machineId}/calendar/days/${calendarDate}`, {
    token,
    method: 'DELETE',
  })
}

export function removeProductionCalendarRange(token, machineId, groupId) {
  return calendarApiRequest(`/api/machines/${machineId}/calendar/groups/${groupId}`, {
    token,
    method: 'DELETE',
  })
}
