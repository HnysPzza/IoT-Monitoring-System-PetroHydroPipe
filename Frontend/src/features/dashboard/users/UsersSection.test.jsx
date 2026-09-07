import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest'
import UsersSection from './UsersSection.jsx'
import { archiveUser, createUser, getRoles, getUsers, updateUserStatus } from './usersService.js'

vi.mock('../../../shared/hooks/useAuth.js', () => ({ useAuth: () => ({ token: 'test-token', user: { id: 'admin' } }) }))
vi.mock('./usersService.js', () => ({ getUsers: vi.fn(), getRoles: vi.fn(), createUser: vi.fn(), archiveUser: vi.fn(), updateUserStatus: vi.fn(), resendSetup: vi.fn() }))

const originalShowModal = HTMLDialogElement.prototype.showModal
const originalClose = HTMLDialogElement.prototype.close
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal
  HTMLDialogElement.prototype.close = originalClose
})

beforeEach(() => {
  vi.clearAllMocks()
  getRoles.mockResolvedValue({ roles: [{ id: 'admin-role', name: 'Admin' }, { id: 'supervisor-role', name: 'Production Supervisor' }] })
  getUsers.mockResolvedValue({ users: [], total: 21, summary: { total: 21, active: 20, inactive: 1, pending: 2 } })
})

it('does not reload the directory when the initial search debounce expires', async () => {
  vi.useFakeTimers()
  try {
    await act(async () => { render(<UsersSection />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(getUsers).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('requests server pages and resets the page when filtering', async () => {
  const user = userEvent.setup()
  render(<UsersSection />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => expect(getUsers).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 2, limit: 10 }), expect.any(AbortSignal)))
  await user.selectOptions(screen.getByLabelText('Status'), 'Inactive')
  await waitFor(() => expect(getUsers).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 1, status: 'Inactive' }), expect.any(AbortSignal)))
})

it('adds a user without credentials and reports unconfirmed email without losing the account', async () => {
  createUser.mockResolvedValue({ user: { id: 'new-user' }, delivery: 'unconfirmed' })
  const user = userEvent.setup()
  render(<UsersSection />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add user' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Add user' }))
  const form = within(screen.getByRole('dialog'))
  expect(form.queryByLabelText(/password/i)).not.toBeInTheDocument()
  expect(form.queryByRole('option', { name: 'Admin', exact: true })).not.toBeInTheDocument()
  await user.type(form.getByLabelText('Full name'), 'New Operator')
  await user.type(form.getByLabelText('Username'), 'operator')
  await user.type(form.getByLabelText('Email'), 'operator@example.test')
  await user.selectOptions(form.getByLabelText('Role'), 'Production Supervisor')
  await user.click(form.getByRole('button', { name: 'Add user' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(createUser).toHaveBeenCalledWith('test-token', { name: 'New Operator', username: 'operator', email: 'operator@example.test', role: 'Production Supervisor' })
  expect(screen.getByRole('alert')).toHaveTextContent(/Account saved, but email delivery is unconfirmed/)
})

it('renders the segmented metric pills with summary counts', async () => {
  render(<UsersSection />)
  await waitFor(() => expect(screen.getByText('21')).toBeInTheDocument())
  expect(screen.getByText('Total Users:')).toBeInTheDocument()
  expect(screen.getByText('Active:')).toBeInTheDocument()
  expect(screen.getByText('20')).toBeInTheDocument()
  expect(screen.getByText('Inactive:')).toBeInTheDocument()
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('Awaiting Setup:')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()
})

it('shows clear filters button only when filters are active and clears on click', async () => {
  const user = userEvent.setup()
  render(<UsersSection />)
  await waitFor(() => expect(screen.getByLabelText('Status')).toBeInTheDocument())

  // Initially no active filter button
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()

  // Apply a filter
  await user.selectOptions(screen.getByLabelText('Status'), 'Active')
  expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()

  // Click clear filters
  await user.click(screen.getByRole('button', { name: /clear filters/i }))
  expect(screen.getByLabelText('Status')).toHaveValue('')
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
})

it('opens confirmation modal and deactivates account on confirm', async () => {
  const account = {
    id: 'user-op',
    name: 'Operator Beta',
    username: 'opbeta',
    email: 'opbeta@example.test',
    role: 'Production Supervisor',
    status: 'Active',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: null,
  }
  getUsers.mockResolvedValue({ users: [account], total: 1, summary: { total: 1, active: 1, inactive: 0, pending: 0 } })
  updateUserStatus.mockResolvedValue({ user: { id: 'user-op', status: 'Inactive' } })

  const user = userEvent.setup()
  render(<UsersSection />)
  await waitFor(() => expect(screen.getByRole('button', { name: /actions for operator beta/i })).toBeInTheDocument())

  // Open row action menu
  await user.click(screen.getByRole('button', { name: /actions for operator beta/i }))
  await waitFor(() => expect(screen.getByRole('button', { name: /deactivate account/i })).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /deactivate account/i }))

  // Confirmation modal should be open
  expect(screen.getByRole('heading', { name: /deactivate user account/i })).toBeInTheDocument()
  expect(screen.getByText(/Are you sure you want to deactivate/i)).toBeInTheDocument()

  // Click confirm button
  await user.click(screen.getByRole('button', { name: /^deactivate$/i }))
  await waitFor(() => expect(updateUserStatus).toHaveBeenCalledWith('test-token', 'user-op', 'Inactive'))
})
