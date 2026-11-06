import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthContext } from '../../auth/authSession.jsx'
import DowntimeSection from './DowntimeSection.jsx'
import { getDowntimeRecords, subscribeToDowntime } from './downtimeService.js'

vi.mock('./downtimeService.js', () => ({
  getDowntimeRecords: vi.fn(),
  subscribeToDowntime: vi.fn(() => () => {}),
  updateDowntimeRecord: vi.fn(),
}))

afterEach(() => { onlineManager.setOnline(true); vi.resetAllMocks() })

it('reuses fresh records on return and labels them stale when offline', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  getDowntimeRecords.mockResolvedValue({ records: [{ id: 'one', displayLabel: 'Cached record', cause: 'Other', status: 'Resolved' }] })
  const view = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ token: 'token', isAuthenticated: true, isRestoring: false, user: { role: 'Admin' } }}><DowntimeSection /></AuthContext.Provider></QueryClientProvider>
  const first = render(view())
  await screen.findByText('Cached record')
  first.unmount()
  const second = render(view())
  expect(screen.getByText('Cached record')).toBeInTheDocument()
  expect(getDowntimeRecords).toHaveBeenCalledTimes(1)
  act(() => onlineManager.setOnline(false))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Downtime data is stale'))
  expect(screen.getByText('Cached record')).toBeInTheDocument()
  second.unmount()
  client.clear()
})

it('retains previous rows while a changed filter is loading', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let finish
  getDowntimeRecords.mockResolvedValueOnce({ records: [{ id: 'old', displayLabel: 'Previous record', cause: 'Other', status: 'Resolved' }] })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={{ token: 'token', isAuthenticated: true, isRestoring: false, user: { role: 'Admin' } }}><DowntimeSection /></AuthContext.Provider></QueryClientProvider>)
  await screen.findByText('Previous record')
  fireEvent.change(screen.getByLabelText('Cause'), { target: { value: 'Misalignment' } })
  await waitFor(() => expect(getDowntimeRecords).toHaveBeenCalledTimes(2))
  expect(screen.getByText('Previous record')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Refreshing')
  await act(async () => finish({ records: [{ id: 'new', displayLabel: 'New record', cause: 'Misalignment', status: 'Resolved' }] }))
  expect(await screen.findByText('New record')).toBeInTheDocument()
  view.unmount()
  client.clear()
})

it('keeps previous rows and shows a retry notice if the changed filter fails', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  getDowntimeRecords.mockResolvedValueOnce({ records: [{ id: 'old', displayLabel: 'Previous record', cause: 'Other', status: 'Resolved' }] })
    .mockRejectedValueOnce(new Error('Filter request failed'))
  const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={{ token: 'token', isAuthenticated: true, isRestoring: false, user: { id: 'one', role: 'Admin' } }}><DowntimeSection /></AuthContext.Provider></QueryClientProvider>)
  await screen.findByText('Previous record')
  fireEvent.change(screen.getByLabelText('Cause'), { target: { value: 'Misalignment' } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Filter request failed')
  expect(screen.getByText('Previous record')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  view.unmount()
  client.clear()
})

it('does not refetch on initial stream open but reconciles on reconnect', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  getDowntimeRecords.mockResolvedValue({ records: [] })
  let handlers
  subscribeToDowntime.mockImplementation((_token, next) => { handlers = next; return () => {} })
  const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={{ token: 'token', isAuthenticated: true, isRestoring: false, user: { role: 'Admin' } }}><DowntimeSection /></AuthContext.Provider></QueryClientProvider>)
  await screen.findByText('No downtime records match the selected filters.')
  act(() => handlers.onOpen({ isReconnect: false, isRetry: false }))
  expect(getDowntimeRecords).toHaveBeenCalledTimes(1)
  act(() => handlers.onOpen({ isReconnect: true, isRetry: false }))
  await waitFor(() => expect(getDowntimeRecords).toHaveBeenCalledTimes(2))
  view.unmount()
  client.clear()
})
