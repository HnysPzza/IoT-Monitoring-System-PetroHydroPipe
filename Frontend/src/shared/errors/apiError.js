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
