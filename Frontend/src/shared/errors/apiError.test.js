import { describe, expect, it } from 'vitest'
import { createApiError } from './apiError.js'

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
