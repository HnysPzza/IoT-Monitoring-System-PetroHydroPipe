import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiError } from './apiError.js'
import { notifyUnauthorized, setUnauthorizedHandler } from './unauthorizedSession.js'

describe('unauthorized session handling', () => {
  afterEach(() => {
    setUnauthorizedHandler(null, null)
  })

  it('notifies only the handler that owns the matching token', () => {
    const handler = vi.fn()
    setUnauthorizedHandler('active-token', handler)
    const error = createApiError('Expired.', 401)

    notifyUnauthorized(error, { token: 'older-token', path: '/api/reports' })
    notifyUnauthorized(createApiError('Forbidden.', 403), { token: 'active-token', path: '/api/users' })
    notifyUnauthorized(error, { token: 'active-token', path: '/api/reports' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(error, { path: '/api/reports' })
  })

  it('does not let cleanup or handler failures replace the request failure', () => {
    const olderHandler = vi.fn()
    const cleanupOlder = setUnauthorizedHandler('older-token', olderHandler)
    const activeHandler = vi.fn(() => {
      throw new Error('Session cleanup failed.')
    })
    setUnauthorizedHandler('active-token', activeHandler)

    cleanupOlder()

    expect(() => {
      notifyUnauthorized(createApiError('Expired.', 401), {
        token: 'active-token',
        path: '/api/alerts',
      })
    }).not.toThrow()
    expect(activeHandler).toHaveBeenCalledTimes(1)
  })
})
