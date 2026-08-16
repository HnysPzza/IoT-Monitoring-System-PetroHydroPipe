import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeToServerEvents } from './eventStream.js'
import { setUnauthorizedHandler } from '../errors/unauthorizedSession.js'

describe('subscribeToServerEvents', () => {
  afterEach(() => {
    setUnauthorizedHandler(null, null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('notifies the shared session handler for an authenticated HTTP 401', async () => {
    vi.useFakeTimers()
    const onUnauthorized = vi.fn()
    const onError = vi.fn()
    const onStatusChange = vi.fn()
    setUnauthorizedHandler('expired-token', onUnauthorized)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'expired-token', { onError, onStatusChange })

    await vi.advanceTimersByTimeAsync(0)
    expect(onUnauthorized).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, code: 'HTTP_401' }),
      { path: '/api/alerts/stream' },
    )
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual(['connecting', 'unauthorized'])
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetch).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('parses authenticated downtime events and stops cleanly', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: downtime.created\ndata: {"downtime":{"id":"downtime-1","status":"Open"}}\n\n',
        ))
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    const onEvent = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/downtime/stream', 'test-token', { onEvent })

    await waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith({
        type: 'downtime.created',
        payload: { downtime: { id: 'downtime-1', status: 'Open' } },
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/downtime/stream',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    unsubscribe()
  })

  it('reports initial, retried, and reconnected successful stream opens without corrupting transport callbacks', async () => {
    vi.useFakeTimers()
    const createStableResponse = () => new Response(new ReadableStream({ start() {} }), { status: 200 })
    const createClosedResponse = () => new Response(new ReadableStream({
      start(controller) {
        controller.close()
      },
    }), { status: 200 })

    const initialOpen = vi.fn(() => {
      throw new Error('consumer callback failed')
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createStableResponse()))
    const stopInitial = subscribeToServerEvents('/api/alerts/stream', 'test-token', { onOpen: initialOpen })
    await vi.advanceTimersByTimeAsync(0)
    expect(initialOpen).toHaveBeenCalledWith({ isReconnect: false, isRetry: false })
    stopInitial()

    const retriedOpen = vi.fn()
    const retryFetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(createStableResponse())
    vi.stubGlobal('fetch', retryFetch)
    const stopRetried = subscribeToServerEvents('/api/alerts/stream', 'test-token', { onOpen: retriedOpen })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(retriedOpen).toHaveBeenCalledWith({ isReconnect: false, isRetry: true })
    stopRetried()

    const reconnectOpen = vi.fn()
    const reconnectFetch = vi.fn()
      .mockResolvedValueOnce(createClosedResponse())
      .mockResolvedValueOnce(createStableResponse())
    vi.stubGlobal('fetch', reconnectFetch)
    const stopReconnect = subscribeToServerEvents('/api/alerts/stream', 'test-token', { onOpen: reconnectOpen })
    await vi.advanceTimersByTimeAsync(0)
    expect(reconnectOpen).toHaveBeenNthCalledWith(1, { isReconnect: false, isRetry: false })
    await vi.advanceTimersByTimeAsync(2000)
    expect(reconnectOpen).toHaveBeenNthCalledWith(2, { isReconnect: true, isRetry: true })
    stopReconnect()
  })

  it('starts fallback polling after repeated short-lived successful streams', async () => {
    vi.useFakeTimers()
    const createClosedResponse = () => new Response(
      new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
      { status: 200 },
    )
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(createClosedResponse()))
    const onError = vi.fn()
    const onFallback = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/downtime/stream', 'test-token', { onError, onFallback })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onFallback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onFallback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledTimes(3)
    expect(onFallback).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(8000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(onFallback).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('ignores comment-only streams and reaches fallback without reporting recovery', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const createCommentResponse = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': keepalive\n\n'))
        controller.close()
      },
    }), { status: 200 })
    const onEvent = vi.fn()
    const onFallback = vi.fn()
    const onRecovery = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(createCommentResponse())))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'test-token', {
      onEvent,
      onFallback,
      onRecovery,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)

    expect(onEvent).not.toHaveBeenCalled()
    expect(onRecovery).not.toHaveBeenCalled()
    expect(onFallback).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('treats a malformed SSE payload as a connection failure instead of confirming live', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: alert.created\ndata: {invalid-json}\n\n'))
      },
    })
    const onEvent = vi.fn()
    const onError = vi.fn()
    const onStatusChange = vi.fn()
    const cancelSpy = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel')
    const releaseLockSpy = vi.spyOn(ReadableStreamDefaultReader.prototype, 'releaseLock')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'test-token', {
      onEvent,
      onError,
      onStatusChange,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(onEvent).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(releaseLockSpy).toHaveBeenCalledTimes(1)
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual(['connecting', 'reconnecting'])
    unsubscribe()
    cancelSpy.mockRestore()
    releaseLockSpy.mockRestore()
  })

  it('confirms live only after a parsed heartbeat and allows a future fallback cycle after recovery', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const heartbeatThenClose = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: heartbeat\ndata: {"ok":true}\n\n'))
        controller.close()
      },
    }), { status: 200 })
    let stableController
    const stableHeartbeat = () => new Response(new ReadableStream({
      start(controller) {
        stableController = controller
        controller.enqueue(encoder.encode('event: heartbeat\ndata: {"ok":true}\n\n'))
      },
    }), { status: 200 })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(heartbeatThenClose()))
      .mockImplementationOnce(() => Promise.resolve(heartbeatThenClose()))
      .mockImplementationOnce(() => Promise.resolve(heartbeatThenClose()))
      .mockImplementationOnce(() => Promise.resolve(stableHeartbeat()))
      .mockImplementation(() => Promise.resolve(heartbeatThenClose()))
    const onFallback = vi.fn()
    const onRecovery = vi.fn()
    const onStatusChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'test-token', {
      onFallback,
      onRecovery,
      onStatusChange,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onRecovery).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(8000)
    expect(onRecovery).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4999)
    expect(onRecovery).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onRecovery).toHaveBeenCalledTimes(1)
    expect(onStatusChange).toHaveBeenCalledWith('live')

    stableController.close()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    expect(onFallback).toHaveBeenCalledTimes(2)
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      'connecting',
      'reconnecting',
      'degraded',
      'live',
      'reconnecting',
      'degraded',
    ])
    unsubscribe()
  })

  it('cleans up its retry timer and active request on unsubscribe', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'test-token')
    await vi.advanceTimersByTimeAsync(0)
    const signal = fetchMock.mock.calls[0][1].signal

    unsubscribe()
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels a late response body and never reports an open after unsubscribe', async () => {
    const responseRequest = Promise.withResolvers()
    const onOpen = vi.fn()
    let bodyCancelled = false
    const body = new ReadableStream({
      cancel() {
        bodyCancelled = true
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(responseRequest.promise))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'test-token', { onOpen })
    unsubscribe()
    responseRequest.resolve(new Response(body, { status: 200 }))

    await waitFor(() => {
      expect(bodyCancelled).toBe(true)
    })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['stream.auth_expired', 'SSE_AUTH_EXPIRED'],
    ['stream.auth_revoked', 'SSE_AUTH_REVOKED'],
  ])('treats %s as terminal and never parses later events from the same chunk', async (eventType, errorCode) => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const onUnauthorized = vi.fn()
    const onEvent = vi.fn()
    const onError = vi.fn()
    const onFallback = vi.fn()
    const onStatusChange = vi.fn()
    setUnauthorizedHandler('active-token', onUnauthorized)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `event: ${eventType}\ndata: {"reason":"ended"}\n\n`
          + 'event: alert.created\ndata: {"alert":{"id":"must-not-arrive"}}\n\n',
        ))
      },
    }), { status: 200 })))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', {
      onEvent,
      onError,
      onFallback,
      onStatusChange,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(onUnauthorized).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, code: errorCode }),
      { path: '/api/alerts/stream' },
    )
    expect(onEvent).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onFallback).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenLastCalledWith('unauthorized')
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetch).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('treats stream HTTP 403 as terminal without changing generic API behavior', async () => {
    vi.useFakeTimers()
    const onUnauthorized = vi.fn()
    const onFallback = vi.fn()
    setUnauthorizedHandler('active-token', onUnauthorized)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))

    const unsubscribe = subscribeToServerEvents('/api/downtime/stream', 'active-token', { onFallback })
    await vi.advanceTimersByTimeAsync(0)

    expect(onUnauthorized).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
      { path: '/api/downtime/stream' },
    )
    expect(onFallback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetch).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('honors bounded Retry-After for 429 responses without starting fallback polling', async () => {
    vi.useFakeTimers()
    const onFallback = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 429,
      headers: { 'Retry-After': '60' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', { onFallback })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(29999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onFallback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onFallback).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('backs off authorization-check failures, degrades after three, and cancels the pending retry on unsubscribe', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const authorizationCheckFailureResponse = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: stream.reconnect\ndata: {"reason":"authorization_check_failed"}\n\n',
        ))
        controller.close()
      },
    }), { status: 200 })
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(authorizationCheckFailureResponse()))
    const onError = vi.fn()
    const onFallback = vi.fn()
    const onStatusChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', {
      onError,
      onFallback,
      onStatusChange,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SSE_AUTHORIZATION_CHECK_FAILED',
      payload: { reason: 'authorization_check_failed' },
    }))
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1749)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    expect(onError).toHaveBeenCalledTimes(3)
    expect(onFallback).not.toHaveBeenCalled()
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      'connecting',
      'reconnecting',
      'degraded',
    ])

    unsubscribe()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('clears authorization-check recovery only after a periodic validation event', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const authorizationCheckFailureResponse = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: stream.reconnect\ndata: {"reason":"authorization_check_failed"}\n\n',
        ))
        controller.close()
      },
    }), { status: 200 })
    let stableStreamController
    const stableResponse = () => new Response(new ReadableStream({
      start(controller) {
        stableStreamController = controller
        controller.enqueue(encoder.encode('event: heartbeat\ndata: {"ok":true}\n\n'))
      },
    }), { status: 200 })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(authorizationCheckFailureResponse()))
      .mockImplementationOnce(() => Promise.resolve(stableResponse()))
      .mockImplementationOnce(() => Promise.resolve(authorizationCheckFailureResponse()))
      .mockImplementationOnce(() => Promise.resolve(authorizationCheckFailureResponse()))
    const onFallback = vi.fn()
    const onRecovery = vi.fn(() => {
      throw new Error('consumer callback failed')
    })
    const onStatusChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', {
      onFallback,
      onRecovery,
      onStatusChange,
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(5000)

    expect(onRecovery).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')

    stableStreamController.enqueue(encoder.encode(
      'event: stream.auth_validated\ndata: {"timestamp":"2026-08-16T00:00:00.000Z"}\n\n',
    ))
    await vi.advanceTimersByTimeAsync(0)

    expect(onRecovery).toHaveBeenCalledTimes(1)
    expect(onStatusChange).toHaveBeenLastCalledWith('live')

    stableStreamController.enqueue(encoder.encode(
      'event: stream.reconnect\ndata: {"reason":"authorization_check_failed"}\n\n',
    ))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onFallback).not.toHaveBeenCalled()
    expect(onStatusChange).not.toHaveBeenCalledWith('degraded')
    unsubscribe()
  })

  it('keeps authorization recovery active across HTTP failures without starting fallback polling', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const authorizationCheckFailureResponse = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: stream.reconnect\ndata: {"reason":"authorization_check_failed"}\n\n',
        ))
        controller.close()
      },
    }), { status: 200 })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(authorizationCheckFailureResponse()))
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 500 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(null, {
        status: 429,
        headers: { 'Retry-After': '60' },
      })))
      .mockImplementationOnce(() => Promise.resolve(authorizationCheckFailureResponse()))
    const onError = vi.fn()
    const onFallback = vi.fn()
    const onStatusChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', {
      onError,
      onFallback,
      onStatusChange,
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    await vi.advanceTimersByTimeAsync(29999)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(onError).toHaveBeenCalledTimes(4)
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      'SSE_AUTHORIZATION_CHECK_FAILED',
      'HTTP_500',
      'HTTP_429',
      'SSE_AUTHORIZATION_CHECK_FAILED',
    ])
    expect(onFallback).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenLastCalledWith('degraded')
    unsubscribe()
  })

  it('clears a zero-valued retry timer during unsubscribe', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockReturnValue(0)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token')
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()

    expect(setTimeoutSpy).toHaveBeenCalled()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(0)
    setTimeoutSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
  })

  it('isolates throwing callbacks from retry and recovery transport state', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const eventThenClose = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: alert.created\ndata: {"alert":{"id":"event-1"}}\n\n'))
        controller.close()
      },
    }), { status: 200 })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(eventThenClose()))
      .mockRejectedValue(new Error('offline'))
    const onEvent = vi.fn(() => {
      throw new Error('event callback failed')
    })
    const onError = vi.fn(() => {
      throw new Error('error callback failed')
    })
    const onFallback = vi.fn(() => {
      throw new Error('fallback callback failed')
    })
    const onStatusChange = vi.fn(() => {
      throw new Error('status callback failed')
    })
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', {
      onError,
      onEvent,
      onFallback,
      onStatusChange,
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    await vi.advanceTimersByTimeAsync(8000)

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(4)
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    unsubscribe()
  })

  it('contains a rejected asynchronous consumer callback', async () => {
    const encoder = new TextEncoder()
    const rejectedCallback = Promise.reject(new Error('asynchronous callback failed'))
    const catchSpy = vi.spyOn(rejectedCallback, 'catch')
    rejectedCallback.catch(() => {})
    const onEvent = vi.fn(() => rejectedCallback)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: alert.created\ndata: {"alert":{"id":"event-1"}}\n\n'))
      },
    }), { status: 200 })))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', { onEvent })

    await waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(1)
    })
    expect(catchSpy).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it.each(['max_lifetime', 'server_shutdown'])('reconnects normally after a planned %s server control event without reporting an error', async (reason) => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const reconnectResponse = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `event: stream.reconnect\ndata: {"reason":"${reason}"}\n\n`
          + 'event: alert.created\ndata: {"alert":{"id":"must-not-arrive"}}\n\n',
        ))
        controller.close()
      },
    }), { status: 200 })
    const stableResponse = () => new Response(new ReadableStream({
      start() {},
    }), { status: 200 })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(reconnectResponse()))
      .mockImplementationOnce(() => Promise.resolve(stableResponse()))
    const onError = vi.fn()
    const onFallback = vi.fn()
    const onEvent = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'active-token', { onError, onEvent, onFallback })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(249)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    expect(onFallback).not.toHaveBeenCalled()
    unsubscribe()
  })
})
