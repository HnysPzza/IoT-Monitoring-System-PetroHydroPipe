import { createApiError } from '../../../shared/errors/apiError.js'
import { notifyUnauthorized } from '../../../shared/errors/unauthorizedSession.js'
import { API_BASE_URL, apiRequest, DEFAULT_REQUEST_TIMEOUT_MS } from '../../../shared/services/apiClient.js'
import { assertSessionCurrent, getSessionContext, refreshSessionOnce } from '../../../shared/services/sessionRefresh.js'

export const reportCategories = [
  { id: 'regular', label: 'Regular Report' },
  { id: 'production', label: 'Production Report' },
]

export const reportTypes = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
]

export function getReportSummary(token, { category = 'regular', reportType, selectedDate, includeComparison = false }, { signal } = {}) {
  const params = new URLSearchParams()
  const normalizedDate = selectedDate?.length === 7 ? `${selectedDate}-01` : selectedDate

  params.set('category', category)
  params.set('type', reportType)
  if (normalizedDate) params.set('date', normalizedDate)
  if (includeComparison) params.set('compare', 'true')

  return apiRequest(`/api/reports/summary?${params.toString()}`, { token, signal })
}

function sanitizeFilenameToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '')
}

function buildFallbackExportFilename({ category = 'regular', reportType, selectedDate, format }) {
  const categoryLabel = category === 'production' ? 'Production' : 'Operational'
  const cleanType = sanitizeFilenameToken(reportType)
  const typeLabel = cleanType
    ? `${cleanType.charAt(0).toUpperCase()}${cleanType.slice(1)}Report`
    : 'Report'
  const dateLabel = sanitizeFilenameToken(selectedDate) || 'undated'
  const extLabel = sanitizeFilenameToken(format)
  return `${categoryLabel}-${typeLabel}-${dateLabel}.${extLabel}`
}

function getExportFilename(disposition, fallback) {
  const match = disposition?.match(/filename="([^"]+)"/)
  return match?.[1] || fallback
}

// Exports stream a file, not JSON, so this cannot reuse apiRequest's JSON parsing.
export async function exportReport(token, { category = 'regular', reportType, selectedDate, format }) {
  const normalizedDate = selectedDate?.length === 7 ? `${selectedDate}-01` : selectedDate
  const path = '/api/reports/export'
  const sessionContext = getSessionContext(token)
  let activeToken = token
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const requestBody = JSON.stringify({ category, type: reportType, date: normalizedDate, format })

  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)

  try {
    let response

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      })

      if (response.status === 401) {
        assertSessionCurrent(sessionContext)
        const refreshedToken = await refreshSessionOnce(sessionContext, { signal: controller.signal })

        if (refreshedToken && refreshedToken !== token) {
          activeToken = refreshedToken
          response = await fetch(`${API_BASE_URL}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: { ...requestHeaders, Authorization: `Bearer ${refreshedToken}` },
            body: requestBody,
            signal: controller.signal,
          })
        }
      }
    } catch (error) {
      if (error?.code === 'SESSION_CHANGED' || error?.status) throw error
      if (error?.name === 'AbortError') {
        throw createApiError('The export request timed out. Please try again.', 0, null, 'REQUEST_TIMEOUT')
      }

      throw createApiError('Unable to reach the server. Check your connection and try again.', 0, null, 'NETWORK_ERROR')
    }

    if (!response.ok) {
      let payload = null
      try {
        payload = await response.json()
      } catch {
        // Non-JSON error bodies keep the fallback message.
      }

      const error = createApiError(
        payload?.error?.message || 'Unable to export the report.',
        response.status,
        payload,
      )
      notifyUnauthorized(error, { token: activeToken, path })
      throw error
    }

    const blob = await response.blob()
    const filename = getExportFilename(
      response.headers.get('content-disposition'),
      buildFallbackExportFilename({
        category,
        reportType,
        selectedDate: normalizedDate,
        format,
      }),
    )

    return { blob, filename }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}
