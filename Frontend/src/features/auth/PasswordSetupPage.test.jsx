import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PasswordSetupPage from './PasswordSetupPage.jsx'
import { apiRequest } from '../../shared/services/apiClient.js'

const authState = vi.hoisted(() => ({
  token: 'access-token',
  logout: vi.fn(),
}))

vi.mock('../../shared/hooks/useAuth.js', () => ({ useAuth: () => authState }))
vi.mock('../../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))
beforeEach(() => { apiRequest.mockReset().mockResolvedValue({ validForMs: 3600000 }) })
afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
})

it('scrubs the token from the URL and submits only matching passwords', async () => {
  const token = 'a'.repeat(64)
  window.history.replaceState(null, '', `/setup-password#token=${token}`)
  apiRequest.mockResolvedValue({ validForMs: 3600000, completed: true })
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(window.location.hash).toBe('')
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), 'a-strong-password')
  await user.type(screen.getByLabelText('Confirm password'), 'different-password')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect(apiRequest).not.toHaveBeenCalledWith('/api/auth/setup-password', expect.anything())
  await user.clear(screen.getByLabelText('Confirm password'))
  await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/auth/setup-password', expect.objectContaining({ body: { token, password: 'a-strong-password' } })))
  expect(await screen.findByText(/Password saved/)).toBeInTheDocument()
})

it('shows a recovery state instead of the form when the setup link is missing', () => {
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(screen.getByRole('alert')).toHaveTextContent(/link unavailable/i)
  expect(screen.queryByRole('button', { name: 'Set password' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login')
})

it('lets the user reveal and hide the new password', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'b'.repeat(64)}`)
  const user = userEvent.setup()

  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)

  const passwordInput = await screen.findByLabelText('New password')
  expect(passwordInput).toHaveAttribute('type', 'password')

  await user.click(screen.getByRole('button', { name: 'Show new password' }))
  expect(passwordInput).toHaveAttribute('type', 'text')

  await user.click(screen.getByRole('button', { name: 'Hide new password' }))
  expect(passwordInput).toHaveAttribute('type', 'password')
})

it('hides password fields until the server accepts the link', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  let accept
  apiRequest.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve }))
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(/checking/i)
  await act(async () => accept({ validForMs: 3600000 }))
  expect(await screen.findByLabelText('New password')).toBeEnabled()
})

it.each(['expired', 'used', 'revoked'])('blocks a %s link before entering a password', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('Invalid or expired setup link.'), { code: 'SETUP_LINK_INVALID' }))
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent(/expired|used/i)
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
})

it('allows retry after a validation network failure without showing password fields', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  apiRequest.mockRejectedValueOnce(new Error('Unable to reach the server.'))
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not check link/i)
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }))
  expect(await screen.findByLabelText('New password')).toBeEnabled()
})

it('removes the form when the validated lifetime ends', async () => {
  vi.useFakeTimers()
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  apiRequest.mockResolvedValue({ validForMs: 1000 })
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  await act(async () => {})
  expect(screen.getByLabelText('New password')).toBeEnabled()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(/expired|used/i)
})

it('removes the form when the link is consumed before submission', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), 'a-strong-password')
  await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password')
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('Account or setup link is not eligible.'), { code: 'ACCOUNT_OPERATION_INVALID' }))
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/expired|used/i)
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
})

it('submits the legacy password change and signs out after success', async () => {
  apiRequest.mockResolvedValue({ completed: true })
  const user = userEvent.setup()

  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)

  expect(document.querySelector('.password-auth-page')).toHaveClass('password-auth-page-legacy')
  expect(screen.queryByText(/temporary password must be replaced before dashboard access/i)).not.toBeInTheDocument()
  expect(screen.queryByText('Private by design')).not.toBeInTheDocument()
  expect(screen.queryByText('Fresh sign-in required')).not.toBeInTheDocument()

  await user.type(screen.getByLabelText('Current password'), 'temporary-password')
  await user.type(screen.getByLabelText('New password'), 'replacement-password')
  await user.type(screen.getByLabelText('Confirm password'), 'replacement-password')
  await user.click(screen.getByRole('button', { name: 'Change password' }))

  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/auth/change-password', {
    method: 'POST',
    token: 'access-token',
    body: {
      currentPassword: 'temporary-password',
      password: 'replacement-password',
    },
  }))
  expect(authState.logout).toHaveBeenCalledOnce()
})
