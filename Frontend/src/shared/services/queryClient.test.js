import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient, queryKeys } from './queryClient.js'

describe('query cache infrastructure', () => {
  afterEach(() => queryClient.clear())

  it('uses parameterized keys and bounded retries for transient errors', () => {
    const defaults = queryClient.getDefaultOptions().queries
    expect(defaults.gcTime).toBe(600000)
    expect(defaults.refetchOnReconnect).toBe(true)
    expect(defaults.refetchOnWindowFocus).toBe(true)
    expect(defaults.retry(0, { status: 500 })).toBe(true)
    expect(defaults.retry(1, { code: 'NETWORK_ERROR' })).toBe(true)
    expect(defaults.retry(2, { status: 503 })).toBe(false)
    expect(defaults.retry(0, { status: 429 })).toBe(false)
    expect(defaults.retry(0, { status: 401 })).toBe(false)
    expect(defaults.retry(0, { status: 400, code: 'NETWORK_ERROR' })).toBe(false)
    expect(queryKeys.downtime.list({ page: 1 })).not.toEqual(queryKeys.downtime.list({ page: 2 }))
  })

  it('aborts an active query and removes its data when the cache is cleared', async () => {
    const aborted = vi.fn()
    const pending = queryClient.fetchQuery({
      queryKey: queryKeys.downtime.list({ page: 1 }),
      queryFn: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted(); reject(new Error('aborted')) }, { once: true })
      }),
    }).catch(() => {})
    queryClient.clear()
    await pending
    expect(aborted).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData(queryKeys.downtime.list({ page: 1 }))).toBeUndefined()
  })
})
