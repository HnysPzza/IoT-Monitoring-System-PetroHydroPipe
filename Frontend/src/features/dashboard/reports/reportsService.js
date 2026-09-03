import { createApiError } from '../../../shared/errors/apiError.js'
import { notifyUnauthorized } from '../../../shared/errors/unauthorizedSession.js'
import { API_BASE_URL, apiRequest, DEFAULT_REQUEST_TIMEOUT_MS } from '../../../shared/services/apiClient.js'

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

function getExportFilename(disposition, fallback) {
  const match = disposition?.match(/filename="([^"]+)"/)
  return match?.[1] || fallback
}

// Exports stream a file, not JSON, so this cannot reuse apiRequest's JSON parsing.
export async function exportReport(token, { reportType, selectedDate, format }) {
  const normalizedDate = selectedDate?.length === 7 ? `${selectedDate}-01` : selectedDate
  const path = '/api/reports/export'

  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)

  try {
    let response

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type: reportType, date: normalizedDate, format }),
        signal: controller.signal,
      })
    } catch (error) {
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
      notifyUnauthorized(error, { token, path })
      throw error
    }

    const blob = await response.blob()
    const filename = getExportFilename(
      response.headers.get('content-disposition'),
      `report-${reportType}-${normalizedDate || 'undated'}.${format}`,
    )

    return { blob, filename }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}
