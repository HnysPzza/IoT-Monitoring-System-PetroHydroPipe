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
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual(['connecting', 'degraded'])
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
})
