import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSessionContext, refreshSessionOnce, setCurrentSession, setSessionRefresher, withSessionLock } from './sessionRefresh.js'

describe('sessionRefresh', () => {
  it('bounds lock acquisition without running an unlocked fallback', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { locks: { request: (_name, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }) } })
    const operation = vi.fn()
    const assertion = expect(withSessionLock(operation)).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15000)
    await assertion
    expect(operation).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
  it('cancels one waiter without cancelling another caller', async () => {
    let complete
    setSessionRefresher(() => new Promise((resolve) => { complete = resolve }))
    const controller = new AbortController()
    const cancelled = refreshSessionOnce(getSessionContext(), { signal: controller.signal })
    const remaining = refreshSessionOnce()
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    complete('replacement')
    await expect(remaining).resolves.toBe('replacement')
  })
  it('reuses the replacement for staggered failures of the same token', async () => {
    const refresher = vi.fn().mockResolvedValue('replacement')
    setSessionRefresher(refresher)
    const context = getSessionContext('expired')
    expect(await refreshSessionOnce(context)).toBe('replacement')
    expect(await refreshSessionOnce(context)).toBe('replacement')
    expect(refresher).toHaveBeenCalledTimes(1)
    await refreshSessionOnce(getSessionContext('replacement'))
    expect(refresher).toHaveBeenCalledTimes(2)
  })
  it.each([
    { user: { id: 'other-user' }, sessionId: 'other-session' },
    { user: { id: 'user-1' }, sessionId: 'other-session' },
  ])('rejects refresh results belonging to a different identity: %j', async (identity) => {
    const received = vi.fn()
    setSessionRefresher(async () => ({ token: 'replacement', ...identity }), received)
    setCurrentSession({ token: 'original', user: { id: 'user-1' }, sessionId: 'session-1' })
    await expect(refreshSessionOnce(getSessionContext('original'))).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(received).toHaveBeenCalledWith(null)
    expect(received).not.toHaveBeenCalledWith(expect.objectContaining({ token: 'replacement' }))
  })
  afterEach(() => {
    setSessionRefresher(null)
    vi.unstubAllGlobals()
  })

  it('coalesces concurrent refreshes into a single call', async () => {
    let resolveRefresh
    const refresher = vi.fn(() => new Promise((resolve) => {
      resolveRefresh = resolve
    }))
    setSessionRefresher(refresher)

    const first = refreshSessionOnce()
    const second = refreshSessionOnce()

    resolveRefresh('new-token')
    await expect(first).resolves.toBe('new-token')
    await expect(second).resolves.toBe('new-token')
    expect(refresher).toHaveBeenCalledTimes(1)
  })

  it('returns null when no refresher is registered', async () => {
    await expect(refreshSessionOnce()).resolves.toBeNull()
  })

  it('propagates failure and allows the next attempt to run', async () => {
    const refresher = vi.fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValue('new-token')
    setSessionRefresher(refresher)

    await expect(refreshSessionOnce()).rejects.toThrow('refresh failed')
    await expect(refreshSessionOnce()).resolves.toBe('new-token')
    expect(refresher).toHaveBeenCalledTimes(2)
  })

  it('uses a same-origin session that arrives while waiting for a tab lock', async () => {
    class FakeBroadcastChannel {
      static channels = new Set()

      constructor(name) {
        this.name = name
        this.listeners = new Set()
        FakeBroadcastChannel.channels.add(this)
      }

      addEventListener(type, listener) {
        if (type === 'message') this.listeners.add(listener)
      }

      postMessage(data) {
        for (const channel of FakeBroadcastChannel.channels) {
          if (channel !== this && channel.name === this.name) {
            channel.listeners.forEach((listener) => listener({ data }))
          }
        }
      }

      close() {
        FakeBroadcastChannel.channels.delete(this)
      }
    }

    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const externalChannel = new BroadcastChannel('petrohydropipe-session')
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name, _options, callback) => {
          externalChannel.postMessage({
            type: 'session-refreshed',
            session: { token: 'shared-token', user: { id: 'user-1' } },
          })
          return callback()
        },
      },
    })
    const refresher = vi.fn().mockResolvedValue({ token: 'own-token' })
    setSessionRefresher(refresher)

    await expect(refreshSessionOnce()).resolves.toBe('shared-token')
    expect(refresher).not.toHaveBeenCalled()
    externalChannel.close()
  })
})
