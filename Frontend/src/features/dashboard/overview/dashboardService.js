import { apiRequest } from '../../../shared/services/apiClient.js'

const PRODUCTION_PERIOD_STATES = new Set(['completed', 'current', 'future'])

function isCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isProductionPoint(point) {
  return Boolean(
    point
    && typeof point.label === 'string'
    && PRODUCTION_PERIOD_STATES.has(point.periodState)
    && (point.current === null || isCount(point.current))
    && (point.previous === null || isCount(point.previous)),
  )
}

function isDashboardOverview(payload) {
  const day = payload?.productionAnalytics?.day
  return Boolean(
    Array.isArray(payload?.alerts)
    && payload.alerts.every((alert) => typeof alert?.message === 'string')
    && Array.isArray(payload.summary)
    && payload.summary.every((item) => (
      typeof item?.id === 'string'
      && typeof item.label === 'string'
      && typeof item.value === 'string'
      && typeof item.helper === 'string'
    ))
    && typeof day?.label === 'string'
    && typeof day.currentLabel === 'string'
    && typeof day.previousLabel === 'string'
    && typeof day.unit === 'string'
    && isCount(day.currentTotal)
    && isCount(day.previousTotal)
    && typeof day.difference === 'number'
    && Number.isFinite(day.difference)
    && (day.differencePercent === null || (typeof day.differencePercent === 'number' && Number.isFinite(day.differencePercent)))
    && Array.isArray(day.points)
    && day.points.every(isProductionPoint),
  )
}

export async function getDashboardOverview(token, { trendMode, date } = {}) {
  const params = new URLSearchParams()
  const normalizedDate = trendMode === 'month' && date?.length === 7 ? `${date}-01` : date

  if (trendMode) params.set('trendMode', trendMode)
  if (normalizedDate) params.set('date', normalizedDate)

  const queryString = params.toString()
  const payload = await apiRequest(`/api/dashboard/overview${queryString ? `?${queryString}` : ''}`, { token })
  if (!isDashboardOverview(payload)) {
    throw new Error('The server returned an invalid dashboard overview response.')
  }
  return payload
}

export function getDashboardDowntimeImpact(token, { trendMode, date } = {}) {
  const params = new URLSearchParams()
  const normalizedDate = trendMode === 'month' && date?.length === 7 ? `${date}-01` : date

  if (trendMode) params.set('trendMode', trendMode)
  if (normalizedDate) params.set('date', normalizedDate)

  const queryString = params.toString()
  return apiRequest(`/api/dashboard/downtime-impact${queryString ? `?${queryString}` : ''}`, { token })
}
