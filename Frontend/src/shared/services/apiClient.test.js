import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiRequest,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './apiClient.js'
import { setUnauthorizedHandler } from '../errors/unauthorizedSession.js'
import { beginSessionChange, setSessionRefresher } from './sessionRefresh.js'

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

  it('cancels a request from an external abort signal', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))

    const request = apiRequest('/api/cancelled', { signal: controller.signal })
    controller.abort()

    await expect(request).rejects.toMatchObject({
      name: 'ApiError',
      code: 'REQUEST_ABORTED',
      message: 'The request was cancelled.',
    })
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

describe('apiRequest session refresh', () => {
  it('notifies the active replacement session when its retry is unauthorized', async () => {
    const expired = vi.fn()
    setSessionRefresher(async () => {
      setUnauthorizedHandler('replacement', expired)
      return 'replacement'
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(apiRequest('/api/alerts', { token: 'original' })).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
  })
  it.each(['timeout', 'abort'])('honors %s while waiting for shared refresh', async (reason) => {
    vi.useFakeTimers()
    let resolveRefresh
    setSessionRefresher(() => new Promise((resolve) => { resolveRefresh = resolve }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const controller = new AbortController()
    let result
    const request = apiRequest('/api/alerts', { token: 'old', timeoutMs: 100, signal: controller.signal })
      .catch((error) => { result = error })
    await vi.advanceTimersByTimeAsync(0)
    if (reason === 'abort') controller.abort()
    await vi.advanceTimersByTimeAsync(reason === 'timeout' ? 100 : 0)
    try {
      expect(result?.code).toBe(reason === 'timeout' ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED')
    } finally {
      resolveRefresh(null)
      await request
    }
  })
  it('does not retry an old write after the session changes', async () => {
    let resolveRequest
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
      .mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const refresher = vi.fn(async () => 'another-account-token')
    setSessionRefresher(refresher)
    const request = apiRequest('/api/users/target/archive', { token: 'old-account-token', method: 'PATCH' })
    const assertion = expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    beginSessionChange()
    resolveRequest(new Response('{}', { status: 401 }))
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(refresher).not.toHaveBeenCalled()
  })
  afterEach(() => {
    setUnauthorizedHandler(null, null)
    setSessionRefresher(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends credentials so the refresh cookie travels', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/api/auth/refresh', { method: 'POST' })

    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('retries a 401 once with the refreshed token', async () => {
    const unauthorized = new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token.' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const ok = new Response(JSON.stringify({ report: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', fetchMock)
    setSessionRefresher(async () => 'refreshed-token')

    await expect(apiRequest('/api/reports/summary', { token: 'stale-token' })).resolves.toEqual({ report: {} })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer stale-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-token')
  })

  it('coalesces parallel 401s into one refresh call', async () => {
    const unauthorized = () => new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token.' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const ok = new Response(null, { status: 204 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValue(ok)
      .mockResolvedValue(ok)
    vi.stubGlobal('fetch', fetchMock)
    const refresher = vi.fn(async () => 'refreshed-token')
    setSessionRefresher(refresher)

    await Promise.all([
      apiRequest('/api/reports/summary', { token: 'stale-token' }),
      apiRequest('/api/alerts', { token: 'stale-token' }),
    ])

    expect(refresher).toHaveBeenCalledTimes(1)
  })

  it('never refreshes auth endpoints and gives up after one retry', async () => {
    const unauthorized = () => new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token.' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const fetchMock = vi.fn().mockResolvedValue(unauthorized())
    vi.stubGlobal('fetch', fetchMock)
    const refresher = vi.fn(async () => 'refreshed-token')
    setSessionRefresher(refresher)

    await expect(apiRequest('/api/reports/summary', { token: 'stale-token' })).rejects.toMatchObject({
      status: 401,
    })
    await expect(apiRequest('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(refresher).toHaveBeenCalledTimes(1)
  })
})
