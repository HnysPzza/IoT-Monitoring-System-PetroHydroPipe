import { describe, expect, it } from 'vitest'
import { createApiError, isTransientApiError } from '../apiError.js'

describe('createApiError', () => {
  it('preserves the stable API error fields', () => {
    const payload = { error: { code: 'ACCOUNT_INACTIVE' } }
    const error = createApiError('User account is inactive.', 403, payload)

    expect(error).toMatchObject({
      name: 'ApiError',
      message: 'User account is inactive.',
      status: 403,
      code: 'ACCOUNT_INACTIVE',
      payload,
    })
  })

  it('uses predictable fallback codes without a backend payload', () => {
    expect(createApiError('Offline.')).toMatchObject({ code: 'REQUEST_ERROR', status: 0 })
    expect(createApiError('Unavailable.', 503)).toMatchObject({ code: 'HTTP_503', status: 503 })
  })
})


describe('isTransientApiError', () => {
  it.each([
    createApiError('Unexpected server error.', 500),
    createApiError('Unavailable.', 503),
    createApiError('Too many requests.', 429),
    createApiError('Offline.', 0, null, 'NETWORK_ERROR'),
    createApiError('Slow.', 0, null, 'REQUEST_TIMEOUT'),
  ])('treats $status $code as a transient failure', (error) => {
    expect(isTransientApiError(error)).toBe(true)
  })

  it.each([
    createApiError('Expired.', 401),
    createApiError('Forbidden.', 403),
    createApiError('Changed.', 0, null, 'SESSION_CHANGED'),
    createApiError('Cancelled.', 0, null, 'REQUEST_ABORTED'),
    new Error('plain failure'),
    null,
  ])('does not treat %s as transient', (error) => {
    expect(isTransientApiError(error)).toBe(false)
  })
})
