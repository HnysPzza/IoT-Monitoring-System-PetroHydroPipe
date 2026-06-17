export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

// Handles empty responses safely before trying to parse JSON.
async function readJson(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  return JSON.parse(text)
}

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || fallback
}

export function createApiError(message, status, payload) {
  const error = new Error(message)
  error.status = status
  error.payload = payload
  return error
}

// One fetch wrapper for frontend services; token is added here for protected backend routes.
export async function apiRequest(path, { token, method = 'GET', body, headers = {}, fallbackError = 'Unable to complete request.' } = {}) {
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  }

  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await readJson(response)

  if (!response.ok) {
    throw createApiError(getErrorMessage(payload, fallbackError), response.status, payload)
  }

  return payload
}
