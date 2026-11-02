import { act, renderHook as renderHookWithProvider } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveFeedStream } from './useLiveFeedStream.js'
import { getLiveFeed } from './liveService.js'
import { queryKeys } from '../../../shared/services/queryClient.js'

vi.mock('./liveService.js', () => ({
  getLiveFeed: vi.fn(),
}))

function renderHook(callback) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  return renderHookWithProvider(callback, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}

function mockLivePayload({ machineStatus = 'Running', capturedAt = '2026-10-31T12:00:00.000Z' } = {}) {
  return {
    monitoring: { mode: 'enforce', capturedAt },
    machine: {
      id: 'm-1',
      machineCode: 'M-01',
      name: 'Spiral Mill 01',
      status: machineStatus,
    },
    sensors: [
      {
        id: 's-1',
        sensorCode: 'S-01',
        label: 'Raw Material Detection',
        status: 'Running',
        operationalStatus: 'Running',
        physicalStatus: 'Active',
      },
    ],
  }
}

describe('useLiveFeedStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getLiveFeed.mockReset()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads live feed on mount and transitions to success', async () => {
    const payload = mockLivePayload()
    getLiveFeed.mockResolvedValueOnce(payload)

    const { result } = renderHook(() => useLiveFeedStream('test-token'))

    expect(result.current.state).toBe('loading')
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(result.current.state).toBe('success')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.machine?.status).toBe('Running')
    expect(result.current.sensors.length).toBe(1)
  })

  it('applies a newer SSE event directly without refetching', async () => {
    getLiveFeed.mockResolvedValueOnce(mockLivePayload({ capturedAt: '2026-10-31T12:00:00.000Z' }))

    const { result } = renderHook(() => useLiveFeedStream('test-token'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(result.current.machine?.status).toBe('Running')

    const newerEvent = mockLivePayload({
      machineStatus: 'Downtime',
      capturedAt: '2026-10-31T12:00:05.000Z',
    })

    act(() => {
      result.current.applyEvent(newerEvent)
    })

    expect(result.current.machine?.status).toBe('Downtime')
    expect(result.current.state).toBe('success')
    expect(getLiveFeed).toHaveBeenCalledTimes(1)
  })

  it('keeps cached data stale for an older event and confirms it with a newer event', () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
    client.setQueryData(queryKeys.live.snapshot, { data: mockLivePayload({ capturedAt: '2026-10-31T12:00:10.000Z' }), updatedAt: Date.now() })
    getLiveFeed.mockReturnValue(new Promise(() => {}))
    const { result } = renderHookWithProvider(() => useLiveFeedStream('test-token'), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })
    expect(result.current.state).toBe('stale')
    act(() => { result.current.applyEvent(mockLivePayload({ capturedAt: '2026-10-31T12:00:05.000Z' })) })
    expect(result.current.state).toBe('stale')
    act(() => { result.current.applyEvent(mockLivePayload({ machineStatus: 'Downtime', capturedAt: '2026-10-31T12:00:15.000Z' })) })
    expect(result.current.state).toBe('success')
    expect(result.current.machine.status).toBe('Downtime')
  })

  it('drops older SSE events', async () => {
    getLiveFeed.mockResolvedValueOnce(mockLivePayload({
      machineStatus: 'Running',
      capturedAt: '2026-10-31T12:00:10.000Z',
    }))

    const { result } = renderHook(() => useLiveFeedStream('test-token'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    const staleEvent = mockLivePayload({
      machineStatus: 'Downtime',
      capturedAt: '2026-10-31T12:00:05.000Z',
    })

    act(() => {
      result.current.applyEvent(staleEvent)
    })

    expect(result.current.machine?.status).toBe('Running')
  })

  it('does not overwrite with stale data if an older fetch resolves after a newer event', async () => {
    let resolveInitial
    const initialPromise = new Promise((resolve) => { resolveInitial = resolve })
    getLiveFeed.mockReturnValueOnce(initialPromise)

    const { result } = renderHook(() => useLiveFeedStream('test-token'))

    const sseEvent = mockLivePayload({
      machineStatus: 'Downtime',
      capturedAt: '2026-10-31T12:00:15.000Z',
    })

    act(() => {
      result.current.applyEvent(sseEvent)
    })
    expect(result.current.machine?.status).toBe('Downtime')

    await act(async () => {
      resolveInitial(mockLivePayload({
        machineStatus: 'Running',
        capturedAt: '2026-10-31T12:00:05.000Z',
      }))
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(result.current.machine?.status).toBe('Downtime')
  })

  it('runs periodic reconcile fetch every 60s by default', async () => {
    getLiveFeed.mockResolvedValue(mockLivePayload())

    renderHook(() => useLiveFeedStream('test-token'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(getLiveFeed).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })
    expect(getLiveFeed).toHaveBeenCalledTimes(2)
  })
})
