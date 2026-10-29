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


const TRANSIENT_CLIENT_CODES = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT'])

// Transient failures mean the server could not answer, not that the session is invalid.
export function isTransientApiError(error) {
  if (error?.name !== 'ApiError') return false
  return error.status >= 500 || error.status === 429 || TRANSIENT_CLIENT_CODES.has(error.code)
}
