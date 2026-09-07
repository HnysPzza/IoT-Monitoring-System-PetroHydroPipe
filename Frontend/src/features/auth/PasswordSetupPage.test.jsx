import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import PasswordSetupPage from './PasswordSetupPage.jsx'
import { apiRequest } from '../../shared/services/apiClient.js'

vi.mock('../../shared/hooks/useAuth.js', () => ({ useAuth: () => ({}) }))
vi.mock('../../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))
afterEach(() => { window.history.replaceState(null, '', '/'); vi.clearAllMocks() })

it('scrubs the token from the URL and submits only matching passwords', async () => {
  const token = 'a'.repeat(64)
  window.history.replaceState(null, '', `/setup-password#token=${token}`)
  apiRequest.mockResolvedValue({ completed: true })
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(window.location.hash).toBe('')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('New password'), 'a-strong-password')
  await user.type(screen.getByLabelText('Confirm password'), 'different-password')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect(apiRequest).not.toHaveBeenCalled()
  await user.clear(screen.getByLabelText('Confirm password'))
  await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/auth/setup-password', expect.objectContaining({ body: { token, password: 'a-strong-password' } })))
  expect(await screen.findByText(/Password saved/)).toBeInTheDocument()
})

it('disables submission when the setup link is missing', () => {
  render(<MemoryRouter><PasswordSetupPage /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
})
