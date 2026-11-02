import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../auth/authSession.jsx'
import ProductionSection from './ProductionSection.jsx'

afterEach(() => { onlineManager.setOnline(true); vi.restoreAllMocks() })

it('reuses fresh data on return and reports offline cached data', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const load = vi.fn().mockResolvedValue({
    records: [{ id: 'one', customer: 'Cached customer', outputAccepted: true, isSpecified: true }],
    summary: { totalAccepted: 1, specifiedCount: 1, unspecifiedCount: 0, rejectedCount: 0 },
    pagination: { page: 1, totalPages: 1 },
  })
  const view = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ token: 'token', isAuthenticated: true, isRestoring: false, user: { role: 'Admin' } }}><ProductionSection loadProduction={load} /></AuthContext.Provider></QueryClientProvider>
  const first = render(view())
  await screen.findByText('Cached customer')
  first.unmount()
  const second = render(view())
  expect(screen.getByText('Cached customer')).toBeInTheDocument()
  expect(load).toHaveBeenCalledTimes(1)
  act(() => onlineManager.setOnline(false))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Production data is stale'))
  expect(screen.getByText('Cached customer')).toBeInTheDocument()
  second.unmount()
  client.clear()
})

it('shows stale cached rows immediately while refetching once', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const payload = { records: [{ id: 'one', customer: 'Previous customer', outputAccepted: true }], summary: {}, pagination: { page: 1, totalPages: 1 } }
  let resolveRefresh
  const load = vi.fn().mockResolvedValueOnce(payload).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
  const view = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ token: 'token', isAuthenticated: true, isRestoring: false, user: { role: 'Admin' } }}><ProductionSection loadProduction={load} /></AuthContext.Provider></QueryClientProvider>
  const first = render(view())
  await screen.findByText('Previous customer')
  first.unmount()
  const cached = client.getQueryCache().find({ queryKey: ['production'], exact: false })
  client.setQueryData(cached.queryKey, payload, { updatedAt: Date.now() - 31000 })
  const second = render(view())
  expect(screen.getByText('Previous customer')).toBeInTheDocument()
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect(screen.getByText('Refreshing production logs...')).toBeInTheDocument()
  await act(async () => resolveRefresh({ ...payload, records: [{ ...payload.records[0], customer: 'Fresh customer' }] }))
  expect(await screen.findByText('Fresh customer')).toBeInTheDocument()
  expect(load).toHaveBeenCalledTimes(2)
  second.unmount()
  client.clear()
})

it('does not refetch when only the access token changes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const load = vi.fn().mockResolvedValue({ records: [], summary: {}, pagination: { page: 1, totalPages: 1 } })
  const view = (token) => <QueryClientProvider client={client}><AuthContext.Provider value={{ token, isAuthenticated: true, isRestoring: false, user: { id: 'one', role: 'Admin' } }}><ProductionSection loadProduction={load} /></AuthContext.Provider></QueryClientProvider>
  const rendered = render(view('first'))
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  rendered.rerender(view('second'))
  expect(load).toHaveBeenCalledTimes(1)
  rendered.unmount()
  client.clear()
})

it('does not advance server freshness while an optimistic edit is pending', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const load = vi.fn().mockResolvedValue({ records: [{ id: 'one', customer: 'Before edit', outputAccepted: true, status: 'accepted', isEditable: true, isSpecified: true }], summary: {}, pagination: { page: 1, totalPages: 1 } })
  let finish
  const update = vi.fn(() => new Promise((resolve) => { finish = resolve }))
  const user = userEvent.setup()
  const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={{ token: 'token', isAuthenticated: true, isRestoring: false, user: { id: 'one', role: 'Admin' } }}><ProductionSection loadProduction={load} updateProductionSpec={update} /></AuthContext.Provider></QueryClientProvider>)
  await screen.findByText('Before edit')
  const cached = client.getQueryCache().find({ queryKey: ['production'], exact: false })
  const updatedAt = cached.state.dataUpdatedAt
  await user.click(screen.getByRole('button', { name: /edit specification/i }))
  await user.clear(screen.getByLabelText('Specification customer'))
  await user.type(screen.getByLabelText('Specification customer'), 'Pending')
  await user.click(screen.getByRole('button', { name: 'Save specification' }))
  expect(await screen.findByText('Pending')).toBeInTheDocument()
  expect(client.getQueryState(cached.queryKey).dataUpdatedAt).toBe(updatedAt)
  await act(async () => finish({ spec: { customer: 'Pending' } }))
  view.unmount()
  client.clear()
})
