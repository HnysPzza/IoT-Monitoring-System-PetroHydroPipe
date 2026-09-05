import { createApiError } from '../errors/apiError.js'
import { notifyUnauthorized } from '../errors/unauthorizedSession.js'
import { assertSessionCurrent, getSessionContext, refreshSessionOnce } from './sessionRefresh.js'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000

const AUTH_COOKIE_PATH_PATTERN = /^\/api\/auth\//

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
  signal,
} = {}) {
  const sessionContext = getSessionContext(token)
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
  const abortRequest = () => controller.abort()
  if (signal?.aborted) abortRequest()
  else signal?.addEventListener('abort', abortRequest, { once: true })
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
        credentials: 'include',
        headers: requestHeaders,
        body: serializedBody,
        signal: controller.signal,
      })

      // An expired access token gets exactly one silent refresh and retry.
      if (response.status === 401 && !AUTH_COOKIE_PATH_PATTERN.test(path)) {
        assertSessionCurrent(sessionContext)
        const refreshedToken = await refreshSessionOnce(sessionContext)

        if (refreshedToken && refreshedToken !== token) {
          response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            credentials: 'include',
            headers: { ...requestHeaders, Authorization: `Bearer ${refreshedToken}` },
            body: serializedBody,
            signal: controller.signal,
          })
        }
      }
    } catch (error) {
      if (error.code === 'SESSION_CHANGED') throw error
      if (timedOut) {
        throw createApiError('The request timed out. Please try again.', 0, null, 'REQUEST_TIMEOUT')
      }

      if (signal?.aborted) {
        throw createApiError('The request was cancelled.', 0, null, 'REQUEST_ABORTED')
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
    signal?.removeEventListener('abort', abortRequest)
    globalThis.clearTimeout(timeoutId)
  }
}
