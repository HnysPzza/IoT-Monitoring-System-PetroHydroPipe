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

it.each([false, true])('rejects matching weak passwords in change mode %s', async (changePassword) => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  render(<MemoryRouter><PasswordSetupPage changePassword={changePassword} /></MemoryRouter>)
  const user = userEvent.setup()
  if (changePassword) await user.type(screen.getByLabelText('Current password'), 'old')
  await user.type(await screen.findByLabelText('New password'), 'aaaaaaaaaaaa')
  await user.type(screen.getByLabelText('Confirm password'), 'aaaaaaaaaaaa')
  await user.click(screen.getByRole('button', { name: changePassword ? 'Change password' : 'Set password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/uppercase.*lowercase.*number.*special/i)
  expect(apiRequest).not.toHaveBeenCalledWith(`/api/auth/${changePassword ? 'change-password' : 'setup-password'}`, expect.anything())
})

it('scrubs the token from the URL and submits only matching passwords', async () => {
  const token = 'a'.repeat(64)
  window.history.replaceState(null, '', `/setup-password#token=${token}`)
  apiRequest.mockResolvedValue({ validForMs: 3600000, completed: true })
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(window.location.hash).toBe('')
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), 'A-strong-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'different-password')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect(apiRequest).not.toHaveBeenCalledWith('/api/auth/setup-password', expect.anything())
  await user.clear(screen.getByLabelText('Confirm password'))
  await user.type(screen.getByLabelText('Confirm password'), 'A-strong-password1!')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/auth/setup-password', expect.objectContaining({ body: { token, password: 'A-strong-password1!' } })))
  expect(await screen.findByText(/Password saved/)).toBeInTheDocument()
})

it('validates and completes an administrator-issued password reset link', async () => {
  const token = 'c'.repeat(64)
  window.history.replaceState(null, '', `/reset-password#token=${token}`)
  render(<MemoryRouter><PasswordSetupPage resetPassword /></MemoryRouter>)

  expect(apiRequest).toHaveBeenCalledWith('/api/auth/password-reset/validate', expect.objectContaining({ body: { token } }))
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), 'A-strong-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'A-strong-password1!')
  await user.click(screen.getByRole('button', { name: 'Reset password' }))

  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/auth/password-reset', expect.objectContaining({
    method: 'POST',
    body: { token, password: 'A-strong-password1!' },
  })))
  expect(await screen.findByRole('status')).toHaveTextContent(/Password reset/)
  expect(screen.getByText(/Sign in with your new password/)).toBeInTheDocument()
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
  await user.type(await screen.findByLabelText('New password'), 'A-strong-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'A-strong-password1!')
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('Account or setup link is not eligible.'), { code: 'ACCOUNT_OPERATION_INVALID' }))
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/expired|used/i)
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
})

it.each([
  { mode: 'change', props: { changePassword: true }, title: 'Change password' },
  { mode: 'setup', props: {}, title: 'Create password' },
  { mode: 'reset', props: { resetPassword: true }, title: 'Reset password' },
])('shows upfront 4-rule checklist and validates calmly on blur/submit without keystroke-1 shake in $mode mode', async ({ props, title }) => {
  if (!props.changePassword) {
    window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  }
  const user = userEvent.setup()
  render(<MemoryRouter><PasswordSetupPage {...props} /></MemoryRouter>)

  if (props.changePassword) {
    await user.type(screen.getByLabelText('Current password'), 'temporary-password')
  }
  const newInput = await screen.findByLabelText('New password')
  const confirmInput = screen.getByLabelText('Confirm password')
  const newShell = newInput.closest('.input-shell')
  const confirmShell = confirmInput.closest('.input-shell')

  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  expect(screen.getByText('0 / 72 chars')).toBeInTheDocument()
  expect(screen.getByRole('list', { name: /password requirements/i })).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  expect(screen.getByText(/strength:\s*none/i)).toBeInTheDocument()

  await user.type(newInput, 'weakpass')
  expect(screen.getByText('8 / 72 chars')).toBeInTheDocument()
  expect(screen.getByText(/strength:\s*weak/i)).toBeInTheDocument()
  expect(newShell).not.toHaveClass('has-error')
  expect(newShell).not.toHaveClass('shake')

  await user.tab()
  expect(screen.getByText(/include at least 12 characters, uppercase, lowercase, a number, and a special character/i)).toBeInTheDocument()
  expect(newShell).toHaveClass('has-error')
  expect(newShell).not.toHaveClass('shake')

  await user.click(screen.getByRole('button', { name: title === 'Change password' ? 'Change password' : title === 'Reset password' ? 'Reset password' : 'Set password' }))
  expect(newShell).toHaveClass('shake')

  await user.clear(newInput)
  await user.type(newInput, 'Valid-password1!')
  expect(screen.queryByText(/include at least 12 characters, uppercase, lowercase, a number, and a special character/i)).not.toBeInTheDocument()
  expect(newShell).not.toHaveClass('has-error')
  expect(screen.getByText(/strength:\s*strong/i)).toBeInTheDocument()

  await user.type(confirmInput, 'Mismatch-pass1!')
  expect(screen.getByText(/strength:\s*strong/i)).toBeInTheDocument()
  expect(confirmShell).not.toHaveClass('has-error')
  expect(confirmShell).not.toHaveClass('shake')

  await user.tab()
  expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
  expect(confirmShell).toHaveClass('has-error')
  expect(confirmShell).not.toHaveClass('shake')

  await user.click(screen.getByRole('button', { name: title === 'Change password' ? 'Change password' : title === 'Reset password' ? 'Reset password' : 'Set password' }))
  expect(confirmShell).toHaveClass('shake')
  expect(screen.getAllByText('Passwords do not match.')).toHaveLength(1)

  await user.clear(confirmInput)
  await user.type(confirmInput, 'Valid-password1!')
  expect(screen.queryByText('Passwords do not match.')).not.toBeInTheDocument()
  expect(confirmShell).not.toHaveClass('has-error')
  expect(screen.getByText(/strength:\s*strong/i)).toBeInTheDocument()
})

it('shows remaining link lifetime on valid email link views', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  apiRequest.mockResolvedValueOnce({ validForMs: 3600000 })
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)

  await screen.findByLabelText('New password')
  expect(screen.getByText(/expires in about 60 min/i)).toBeInTheDocument()
})

it('shows Managing Director recovery guidance when a link is missing or expired', () => {
  window.history.replaceState(null, '', '/setup-password')
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)

  expect(screen.getByRole('alert')).toHaveTextContent(/managing director/i)
})

it('shows Caps Lock warning when Caps Lock is active on password fields', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  const user = userEvent.setup()
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)

  const newInput = await screen.findByLabelText('New password')
  await user.click(newInput)
  await user.keyboard('{CapsLock}')
  expect(screen.getByText('Caps Lock is active.')).toBeInTheDocument()
})

it('shows inline error with shake and keeps focus on current password when incorrect', async () => {
  apiRequest.mockRejectedValueOnce({ code: 'PASSWORD_INCORRECT' })
  const user = userEvent.setup()

  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)

  const currentInput = screen.getByLabelText('Current password')
  await user.type(currentInput, 'wrong-current')
  await user.type(screen.getByLabelText('New password'), 'Valid-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'Valid-password1!')
  await user.click(screen.getByRole('button', { name: 'Change password' }))

  expect(await screen.findByText('Password does not match.')).toBeInTheDocument()
  const currentShell = currentInput.closest('.input-shell')
  expect(currentShell).toHaveClass('has-error')
  expect(currentShell).toHaveClass('shake')
  await waitFor(() => expect(currentInput).toHaveFocus())
})

it('shows clear message and focuses current password when blank on submit', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)

  const currentInput = screen.getByLabelText('Current password')
  await user.type(screen.getByLabelText('New password'), 'Valid-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'Valid-password1!')
  await user.click(screen.getByRole('button', { name: 'Change password' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Current password is required.')
  expect(currentInput).toHaveFocus()
})

it('keeps valid setup form mounted and typed values intact across window focus switches', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  const user = userEvent.setup()
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)

  const newInput = await screen.findByLabelText('New password')
  await user.type(newInput, 'PartialPass1!')
  await user.click(screen.getByRole('button', { name: 'Show new password' }))

  act(() => {
    window.dispatchEvent(new Event('focus'))
  })

  expect(screen.queryByText(/checking link/i)).not.toBeInTheDocument()
  expect(screen.getByLabelText('New password')).toHaveValue('PartialPass1!')
  expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text')
  expect(apiRequest).toHaveBeenCalledTimes(1)
})

it('shows rate-limit guidance when link validation is rate limited', async () => {
  window.history.replaceState(null, '', `/setup-password#token=${'a'.repeat(64)}`)
  apiRequest.mockRejectedValueOnce({ code: 'RATE_LIMITED' })
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)

  expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i)
})

it('shows Managing Director recovery guidance for ACCOUNT_OPERATION_INVALID in change mode', async () => {
  apiRequest.mockRejectedValueOnce({ code: 'ACCOUNT_OPERATION_INVALID' })
  const user = userEvent.setup()
  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)

  await user.type(screen.getByLabelText('Current password'), 'temporary-password')
  await user.type(screen.getByLabelText('New password'), 'Replacement-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password1!')
  await user.click(screen.getByRole('button', { name: 'Change password' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/managing director/i)
  expect(alert).not.toHaveTextContent(/link expired or used/i)
})

it('submits the legacy password change and signs out after success', async () => {
  apiRequest.mockResolvedValue({ completed: true })
  const user = userEvent.setup()

  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)

  expect(screen.getByRole('heading', { name: 'Change password' })).toBeInTheDocument()
  expect(screen.queryByText(/temporary password must be replaced before dashboard access/i)).not.toBeInTheDocument()
  expect(screen.queryByText('Private by design')).not.toBeInTheDocument()
  expect(screen.queryByText('Fresh sign-in required')).not.toBeInTheDocument()

  await user.type(screen.getByLabelText('Current password'), 'temporary-password')
  await user.type(screen.getByLabelText('New password'), 'Replacement-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password1!')
  await user.click(screen.getByRole('button', { name: 'Change password' }))

  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/auth/change-password', {
    method: 'POST',
    token: 'access-token',
    body: {
      currentPassword: 'temporary-password',
      password: 'Replacement-password1!',
    },
  }))
  expect(authState.logout).toHaveBeenCalledOnce()
})

it('keeps password-saved confirmation even if logout rejects after change-password succeeds', async () => {
  apiRequest.mockResolvedValue({ completed: true })
  authState.logout.mockRejectedValueOnce(new Error('Network down'))
  const user = userEvent.setup()

  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)

  await user.type(screen.getByLabelText('Current password'), 'temporary-password')
  await user.type(screen.getByLabelText('New password'), 'Replacement-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password1!')
  await user.click(screen.getByRole('button', { name: 'Change password' }))

  expect(await screen.findByText(/Password saved/)).toBeInTheDocument()
  expect(screen.queryByText(/Could not save password/i)).not.toBeInTheDocument()
})

it('explains rate limits without clearing the password form', async () => {
  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'old')
  await user.type(screen.getByLabelText('New password'), 'Valid-password1!')
  await user.type(screen.getByLabelText('Confirm password'), 'Valid-password1!')
  apiRequest.mockRejectedValueOnce({ code: 'RATE_LIMITED' })
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts.*wait.*try again/i)
  expect(screen.getByLabelText('New password')).toHaveValue('Valid-password1!')
})

it('counts Unicode characters instead of UTF-16 units for the minimum length', async () => {
  render(<MemoryRouter><PasswordSetupPage changePassword /></MemoryRouter>)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), 'old')
  await user.type(screen.getByLabelText('New password'), 'Aa1!😀😀😀😀')
  await user.type(screen.getByLabelText('Confirm password'), 'Aa1!😀😀😀😀')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/i)
  expect(apiRequest).not.toHaveBeenCalledWith('/api/auth/change-password', expect.anything())
})
