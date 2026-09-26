import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest'
import UsersActionProvider from './UsersActionProvider.jsx'
import UsersSection from './UsersSection.jsx'
import { archiveUser, createUser, getRoles, getUsers, sendPasswordReset, updateUserStatus } from './usersService.js'

vi.mock('../../../shared/hooks/useAuth.js', () => ({ useAuth: () => ({ token: 'test-token', user: { id: 'admin' } }) }))
vi.mock('./usersService.js', () => ({ getUsers: vi.fn(), getRoles: vi.fn(), createUser: vi.fn(), archiveUser: vi.fn(), updateUserStatus: vi.fn(), resendSetup: vi.fn(), sendPasswordReset: vi.fn() }))

function renderUsers() {
  return render(<UsersActionProvider><UsersSection /></UsersActionProvider>)
}

function UsersRouteHarness() {
  return (
    <>
      <Link to="/dashboard/reports">Reports</Link>
      <Link to="/dashboard/users">Users</Link>
      <Routes>
        <Route path="/dashboard/users" element={<UsersSection />} />
        <Route path="/dashboard/reports" element={<h1>Reports</h1>} />
      </Routes>
    </>
  )
}

function renderUsersRoutes() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/users']}>
      <UsersActionProvider>
        <UsersRouteHarness />
      </UsersActionProvider>
    </MemoryRouter>,
  )
}

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
    await act(async () => { renderUsers() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(getUsers).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('requests server pages and resets the page when filtering', async () => {
  const user = userEvent.setup()
  renderUsers()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => expect(getUsers).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 2, limit: 10 }), expect.any(AbortSignal)))
  await user.selectOptions(screen.getByLabelText('Status'), 'Inactive')
  await waitFor(() => expect(getUsers).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 1, status: 'Inactive' }), expect.any(AbortSignal)))
})

it('adds a user without credentials and reports unconfirmed email without losing the account', async () => {
  createUser.mockResolvedValue({ user: { id: 'new-user' }, delivery: 'unconfirmed' })
  const user = userEvent.setup()
  renderUsers()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add user' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Add user' }))
  const form = within(screen.getByRole('dialog'))
  expect(form.queryByLabelText(/password/i)).not.toBeInTheDocument()
  expect(form.queryByRole('option', { name: 'Admin', exact: true })).not.toBeInTheDocument()
  await user.type(form.getByLabelText('Full name'), 'New Operator')
  await user.type(form.getByLabelText('Username'), 'operator')
  await user.type(form.getByLabelText('Email'), 'operator@example.test')
  await user.selectOptions(form.getByLabelText('Role'), 'Production Supervisor')
  await user.click(form.getByRole('button', { name: 'Send invite' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(createUser).toHaveBeenCalledWith('test-token', { name: 'New Operator', username: 'operator', email: 'operator@example.test', role: 'Production Supervisor' })
  expect(screen.getByRole('alert')).toHaveTextContent(/Account saved, but email delivery is unconfirmed/)
})

it('sends a password reset link from the account actions and confirms provider acceptance', async () => {
  const account = {
    id: 'reset-user',
    name: 'Operator Reset',
    username: 'operator-reset',
    email: 'reset@example.test',
    role: 'Production Supervisor',
    status: 'Active',
    onboarding: 'Ready',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: null,
  }
  getUsers.mockResolvedValue({ users: [account], total: 1, summary: { total: 1, active: 1, inactive: 0, pending: 0 } })
  sendPasswordReset.mockResolvedValue({ delivery: 'accepted' })
  const user = userEvent.setup()
  renderUsers()

  await user.click(await screen.findByRole('button', { name: /actions for operator reset/i }))
  await user.click(screen.getByRole('button', { name: 'Send password reset link' }))

  await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith('test-token', 'reset-user'))
  expect(await screen.findByRole('status')).toHaveTextContent(/Password reset email accepted by Brevo/)
})

it('places Add user in the filter row and removes the advanced setup filter', async () => {
  renderUsers()
  expect(await screen.findByRole('heading', { name: 'Staff accounts' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'User accounts' })).not.toBeInTheDocument()
  expect(screen.queryByText('Total Users:')).not.toBeInTheDocument()
  const addUserButton = screen.getByRole('button', { name: 'Add user' })
  const filters = addUserButton.closest('.users-filters')
  expect(filters).toBeInTheDocument()
  expect(filters.querySelector('details')).toBeNull()
  expect(screen.queryByLabelText('Setup')).not.toBeInTheDocument()
})

it('shows clear filters button only when filters are active and clears on click', async () => {
  const user = userEvent.setup()
  renderUsers()
  await waitFor(() => expect(screen.getByLabelText('Status')).toBeInTheDocument())

  await user.selectOptions(screen.getByLabelText('Sort'), 'name-asc')
  await waitFor(() => expect(getUsers).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ sort: 'name', direction: 'asc' }), expect.any(AbortSignal)))
  expect(screen.getByRole('columnheader', { name: 'User' })).toHaveAttribute('aria-sort', 'ascending')

  // Initially no active filter button
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()

  // Apply a filter
  await user.selectOptions(screen.getByLabelText('Status'), 'Active')
  expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()

  // Click clear filters
  await user.click(screen.getByRole('button', { name: /clear filters/i }))
  expect(screen.getByLabelText('Status')).toHaveValue('')
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
  await waitFor(() => expect(getUsers).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 1, role: '', status: '', sort: 'name', direction: 'asc' }), expect.any(AbortSignal)))
})

it('optimistically deactivates after confirmation and sends the request after the undo window', async () => {
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
  getUsers.mockImplementation(() => Promise.resolve({
    users: [{ ...account, status: updateUserStatus.mock.calls.length ? 'Inactive' : 'Active' }],
    total: 1,
    summary: { total: 1, active: 1, inactive: 0, pending: 0 },
  }))
  updateUserStatus.mockResolvedValue({ user: { id: 'user-op', status: 'Inactive' } })

  const user = userEvent.setup()
  let view
  try {
    view = renderUsers()
    await waitFor(() => expect(screen.getByRole('button', { name: /actions for operator beta/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /actions for operator beta/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /deactivate account/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /deactivate account/i }))

    expect(screen.getByRole('heading', { name: /deactivate user account/i })).toBeInTheDocument()
    expect(screen.getByText(/Are you sure you want to deactivate/i)).toBeInTheDocument()

    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }))
    })

    const row = screen.getByRole('row', { name: /operator beta/i })
    expect(within(row).getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Undo available for 7 seconds/)
    expect(updateUserStatus).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000)
    })

    expect(updateUserStatus).toHaveBeenCalledWith('test-token', 'user-op', 'Inactive')
    expect(within(screen.getByRole('row', { name: /operator beta/i })).getByText('Inactive')).toBeInTheDocument()
  } finally {
    view?.unmount()
    vi.useRealTimers()
  }
})

it('removes an archived account optimistically and restores it when Undo is selected', async () => {
  const account = {
    id: 'user-archive',
    name: 'Operator Gamma',
    username: 'opgamma',
    email: 'opgamma@example.test',
    role: 'Production Supervisor',
    status: 'Active',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: null,
  }
  getUsers.mockResolvedValue({ users: [account], total: 1, summary: { total: 1, active: 1, inactive: 0, pending: 0 } })

  const user = userEvent.setup()
  let view
  try {
    view = renderUsers()
    await waitFor(() => expect(screen.getByRole('button', { name: /actions for operator gamma/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /actions for operator gamma/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /archive account/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /archive account/i }))

    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^archive$/i }))
    })

    expect(screen.queryByRole('button', { name: /actions for operator gamma/i })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Operator Gamma archived/)
    expect(screen.getByRole('button', { name: /undo archive for operator gamma/i })).toHaveFocus()
    expect(archiveUser).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /undo archive for operator gamma/i }))
    })

    expect(screen.getByRole('button', { name: /actions for operator gamma/i })).toBeInTheDocument()
    expect(archiveUser).not.toHaveBeenCalled()
  } finally {
    view?.unmount()
    vi.useRealTimers()
  }
})

it('restores an optimistically deactivated account if the delayed request fails', async () => {
  const account = {
    id: 'user-fail',
    name: 'Operator Delta',
    username: 'opdelta',
    email: 'opdelta@example.test',
    role: 'Production Supervisor',
    status: 'Active',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: null,
  }
  getUsers.mockResolvedValue({ users: [account], total: 1, summary: { total: 1, active: 1, inactive: 0, pending: 0 } })
  updateUserStatus.mockRejectedValue(new Error('Unable to deactivate account.'))

  const user = userEvent.setup()
  let view
  try {
    view = renderUsers()
    await waitFor(() => expect(screen.getByRole('button', { name: /actions for operator delta/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /actions for operator delta/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /deactivate account/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /deactivate account/i }))

    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }))
    })
    expect(within(screen.getByRole('row', { name: /operator delta/i })).getByText('Inactive')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000)
    })

    expect(updateUserStatus).toHaveBeenCalledWith('test-token', 'user-fail', 'Inactive')
    expect(within(screen.getByRole('row', { name: /operator delta/i })).getByText('Active')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Unable to deactivate account/)
  } finally {
    view?.unmount()
    vi.useRealTimers()
  }
})

it('keeps the Undo action available and cancellable after navigating away', async () => {
  const account = {
    id: 'user-route-undo',
    name: 'Operator Epsilon',
    username: 'opepsilon',
    email: 'opepsilon@example.test',
    role: 'Production Supervisor',
    status: 'Active',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: null,
  }
  getUsers.mockResolvedValue({ users: [account], total: 1, summary: { total: 1, active: 1, inactive: 0, pending: 0 } })

  const user = userEvent.setup()
  let view
  try {
    view = renderUsersRoutes()
    await waitFor(() => expect(screen.getByRole('button', { name: /actions for operator epsilon/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /actions for operator epsilon/i }))
    await user.click(await screen.findByRole('button', { name: /deactivate account/i }))
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i })) })
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Reports' })) })

    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /undo deactivate for operator epsilon/i })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /undo deactivate for operator epsilon/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: 'Users' }))
      await Promise.resolve()
    })
    expect(within(screen.getByRole('row', { name: /operator epsilon/i })).getByText('Active')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(7000) })
    expect(updateUserStatus).not.toHaveBeenCalled()
  } finally {
    view?.unmount()
    vi.useRealTimers()
  }
})

it('commits the delayed account action after navigating to another dashboard route', async () => {
  const account = {
    id: 'user-route-commit',
    name: 'Operator Zeta',
    username: 'opzeta',
    email: 'opzeta@example.test',
    role: 'Production Supervisor',
    status: 'Active',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: null,
  }
  getUsers.mockImplementation(() => Promise.resolve({
    users: [{ ...account, status: updateUserStatus.mock.calls.length ? 'Inactive' : 'Active' }],
    total: 1,
    summary: { total: 1, active: 1, inactive: 0, pending: 0 },
  }))
  updateUserStatus.mockResolvedValue({ user: { id: account.id, status: 'Inactive' } })

  const user = userEvent.setup()
  let view
  try {
    view = renderUsersRoutes()
    await waitFor(() => expect(screen.getByRole('button', { name: /actions for operator zeta/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /actions for operator zeta/i }))
    await user.click(await screen.findByRole('button', { name: /deactivate account/i }))
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i })) })
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Reports' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(7000) })

    expect(updateUserStatus).toHaveBeenCalledWith('test-token', account.id, 'Inactive')
    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: 'Users' }))
      await Promise.resolve()
    })
    expect(within(screen.getByRole('row', { name: /operator zeta/i })).getByText('Inactive')).toBeInTheDocument()
  } finally {
    view?.unmount()
    vi.useRealTimers()
  }
})
