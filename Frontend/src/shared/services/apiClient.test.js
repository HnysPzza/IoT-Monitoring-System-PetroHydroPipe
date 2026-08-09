import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiRequest,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './apiClient.js'
import { setUnauthorizedHandler } from '../errors/unauthorizedSession.js'

describe('apiRequest', () => {
  afterEach(() => {
    setUnauthorizedHandler(null, null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('preserves backend error messages, codes, status, and payload', async () => {
    const payload = {
      error: {
        code: 'ACCOUNT_INACTIVE',
        message: 'User account is inactive.',
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(apiRequest('/api/users', { token: 'test-token' })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'User account is inactive.',
      status: 403,
      code: 'ACCOUNT_INACTIVE',
      payload,
    })
  })

  it('returns null for an empty successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(apiRequest('/api/empty')).resolves.toBeNull()
  })

  it('normalizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiRequest('/api/offline')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Unable to reach the server. Check your connection and try again.',
      status: 0,
      code: 'NETWORK_ERROR',
      payload: null,
    })
  })

  it('normalizes body serialization failures without calling fetch', async () => {
    const fetchMock = vi.fn()
    const circularBody = {}
    circularBody.self = circularBody
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/api/users', {
      token: 'test-token',
      method: 'POST',
      body: circularBody,
    })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Unable to prepare the request. Please check the submitted data.',
      status: 0,
      code: 'REQUEST_CONFIGURATION_ERROR',
      payload: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts requests after the bounded default timeout and clears the timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))

    const request = apiRequest('/api/slow')
    const assertion = expect(request).rejects.toMatchObject({
      name: 'ApiError',
      message: 'The request timed out. Please try again.',
      status: 0,
      code: 'REQUEST_TIMEOUT',
      payload: null,
    })

    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('normalizes malformed JSON responses and clears the timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(apiRequest('/api/malformed')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'The server returned an invalid response. Please try again.',
      status: 200,
      code: 'MALFORMED_RESPONSE',
      payload: null,
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('emits unauthorized only for token-authenticated 401 responses', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler('expired-token', onUnauthorized)
    const unauthorizedPayload = {
      error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token.' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(unauthorizedPayload), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(unauthorizedPayload), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'FORBIDDEN', message: 'Forbidden.' },
      }), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/api/protected', { token: 'expired-token' })).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, code: 'UNAUTHENTICATED' }),
      { path: '/api/protected' },
    )

    await expect(apiRequest('/api/auth/login')).rejects.toMatchObject({ status: 401 })
    await expect(apiRequest('/api/protected', { token: 'valid-token' })).rejects.toMatchObject({ status: 403 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
