export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000

let unauthorizedHandler = null
let unauthorizedToken = null

export function setUnauthorizedHandler(token, handler) {
  unauthorizedToken = token || null
  unauthorizedHandler = token && typeof handler === 'function' ? handler : null

  return () => {
    if (unauthorizedToken === token && unauthorizedHandler === handler) {
      unauthorizedToken = null
      unauthorizedHandler = null
    }
  }
}

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

function getErrorCode(payload, status) {
  return payload?.error?.code || (status ? `HTTP_${status}` : 'REQUEST_ERROR')
}

export function createApiError(message, status = 0, payload = null, code = getErrorCode(payload, status)) {
  const error = new Error(message)
  error.name = 'ApiError'
  error.status = status
  error.code = code
  error.payload = payload
  return error
}

export function notifyUnauthorized(error, { token, path } = {}) {
  if (!token || token !== unauthorizedToken || error?.status !== 401 || !unauthorizedHandler) return

  try {
    unauthorizedHandler(error, { path })
  } catch {
    // Session recovery must not replace the original API failure.
  }
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
