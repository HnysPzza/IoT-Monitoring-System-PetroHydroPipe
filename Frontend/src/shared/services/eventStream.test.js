import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeToServerEvents } from './eventStream.js'
import { setUnauthorizedHandler } from './apiClient.js'

describe('subscribeToServerEvents', () => {
  afterEach(() => {
    setUnauthorizedHandler(null, null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('notifies the shared session handler for an authenticated HTTP 401', async () => {
    const onUnauthorized = vi.fn()
    const onError = vi.fn()
    setUnauthorizedHandler('expired-token', onUnauthorized)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))

    const unsubscribe = subscribeToServerEvents('/api/alerts/stream', 'expired-token', { onError })

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401, code: 'HTTP_401' }),
        { path: '/api/alerts/stream' },
      )
    })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
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
})
