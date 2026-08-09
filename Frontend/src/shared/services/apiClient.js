import { createApiError } from '../errors/apiError.js'
import { notifyUnauthorized } from '../errors/unauthorizedSession.js'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000

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

// One fetch wrapper for frontend services; token is added here for protected backend routes.
export async function apiRequest(path, {
  token,
  method = 'GET',
  body,
  headers = {},
  fallbackError = 'Unable to complete request.',
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  }

  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
  }

  let serializedBody

  try {
    serializedBody = body === undefined ? undefined : JSON.stringify(body)
  } catch {
    throw createApiError(
      'Unable to prepare the request. Please check the submitted data.',
      0,
      null,
      'REQUEST_CONFIGURATION_ERROR',
    )
  }

  const controller = new AbortController()
  let timedOut = false
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    let response

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: requestHeaders,
        body: serializedBody,
        signal: controller.signal,
      })
    } catch {
      if (timedOut) {
        throw createApiError('The request timed out. Please try again.', 0, null, 'REQUEST_TIMEOUT')
      }

      throw createApiError('Unable to reach the server. Check your connection and try again.', 0, null, 'NETWORK_ERROR')
    }

    let payload

    try {
      payload = await readJson(response)
    } catch {
      if (timedOut) {
        throw createApiError('The request timed out. Please try again.', 0, null, 'REQUEST_TIMEOUT')
      }

      const error = createApiError(
        'The server returned an invalid response. Please try again.',
        response.status,
        null,
        'MALFORMED_RESPONSE',
      )
      notifyUnauthorized(error, { token, path })
      throw error
    }

    if (!response.ok) {
      const error = createApiError(getErrorMessage(payload, fallbackError), response.status, payload)
      notifyUnauthorized(error, { token, path })
      throw error
    }

    return payload
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}
