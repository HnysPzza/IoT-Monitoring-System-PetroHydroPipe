import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { queryClient } from '../services/queryClient.js'
import { useAuthenticatedQuery } from './useAuthenticatedQuery.js'

const session = vi.hoisted(() => ({ token: null, isAuthenticated: false, isRestoring: true }))
vi.mock('./useAuth.js', () => ({ useAuth: () => session }))

afterEach(() => {
  queryClient.clear()
  Object.assign(session, { token: null, isAuthenticated: false, isRestoring: true })
})

it('waits for session readiness and uses the latest token without refetching on refresh', async () => {
  const fetchData = vi.fn(async ({ token }) => token)
  const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result, rerender } = renderHook(() => useAuthenticatedQuery({
    queryKey: ['private', 'test'], queryFn: fetchData, staleTime: 30000,
  }), { wrapper })
  expect(fetchData).not.toHaveBeenCalled()
  Object.assign(session, { token: 'first', isAuthenticated: true, isRestoring: false })
  rerender()
  await waitFor(() => expect(result.current.data).toBe('first'))
  session.token = 'second'
  rerender()
  expect(fetchData).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.refetch() })
  expect(fetchData).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'second', signal: expect.any(AbortSignal) }))
})
