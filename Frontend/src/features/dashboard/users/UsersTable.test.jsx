import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import UsersTable from './UsersTable.jsx'

const account = {
  id: 'user-2',
  name: 'Operator One',
  username: 'operator01',
  email: 'operator01@petrohydropipe.local',
  role: 'Production Supervisor',
  status: 'Active',
  createdAt: '2026-06-11T00:00:00.000Z',
  lastLoginAt: null,
}

describe('UsersTable', () => {
  it('shows the actual account range on the last page', () => {
    render(<UsersTable accounts={[account]} page={2} pageSize={10} totalCount={11} totalPages={2} onPageChange={vi.fn()} />)
    expect(screen.getByText('Showing 11–11 of 11 accounts')).toBeInTheDocument()
  })

  it('protects any Admin account even when it is not the current row', () => {
    render(<UsersTable accounts={[{ ...account, role: 'Admin' }]} currentUserId="another-user" />)
    const row = screen.getByRole('row', { name: /operator one/i })
    expect(within(row).getByText('Managing Director')).toBeInTheDocument()
    expect(within(row).getByText('Protected')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /actions for/i })).toBeDisabled()
  })

  it('calls archive handler for non-current user archive action', async () => {
    const user = userEvent.setup()
    const onArchiveAccount = vi.fn()

    render(
      <UsersTable
        accounts={[account]}
        currentUserId="user-1"
        archivingUserId=""
        isLoading={false}
        onArchiveAccount={onArchiveAccount}
        onStatusChange={vi.fn()}
        updatingUserId=""
      />,
    )

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    await user.click(screen.getByRole('button', { name: /archive account/i }))

    expect(onArchiveAccount).toHaveBeenCalledWith(account)
  })

  it('offers a password reset link for active accounts that completed setup', async () => {
    const user = userEvent.setup()
    const onResetPassword = vi.fn()
    render(
      <UsersTable
        accounts={[{ ...account, onboarding: 'Ready' }]}
        currentUserId="user-1"
        onResetPassword={onResetPassword}
      />,
    )

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    await user.click(screen.getByRole('button', { name: 'Send password reset link' }))

    expect(onResetPassword).toHaveBeenCalledWith({ ...account, onboarding: 'Ready' })
  })

  it('disables actions trigger for the current user', () => {
    render(
      <UsersTable
        accounts={[account]}
        currentUserId="user-2"
        archivingUserId=""
        isLoading={false}
        onArchiveAccount={vi.fn()}
        onStatusChange={vi.fn()}
        updatingUserId=""
      />,
    )

    expect(screen.getByRole('button', { name: /actions for/i })).toBeDisabled()
  })

  it('applies distinct semantic status tones for Invited, Password change required, Expired, and Inactive accounts', () => {
    render(
      <UsersTable
        accounts={[
          { ...account, id: 'u-inv', name: 'Invited User', onboarding: 'Invited', status: 'Active' },
          { ...account, id: 'u-pw', name: 'Must Change', mustChangePassword: true, status: 'Active' },
          { ...account, id: 'u-inact', name: 'Inactive User', onboarding: 'Ready', status: 'Inactive' },
        ]}
        currentUserId="user-1"
      />,
    )

    expect(screen.getByText('Invited')).toHaveClass('status-fault')
    expect(screen.getByText('Password change required')).toHaveClass('status-fault')
    expect(screen.getByText('Inactive')).toHaveClass('status-offline')
    expect(screen.getAllByRole('cell')[0]).toHaveAttribute('data-label', 'User')
  })

  it('keeps table column headings static when sorting is controlled above the directory', () => {
    render(<UsersTable accounts={[account]} currentUserId="user-1" sort="name" direction="asc" />)

    expect(screen.getByRole('columnheader', { name: 'User' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'User' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.queryByRole('button', { name: /sort by user/i })).not.toBeInTheDocument()
  })
})
