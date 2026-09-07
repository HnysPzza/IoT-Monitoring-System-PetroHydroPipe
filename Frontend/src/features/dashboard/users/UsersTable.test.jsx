import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
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
  it('protects any Admin account even when it is not the current row', async () => {
    const user = userEvent.setup()
    render(<UsersTable accounts={[{ ...account, role: 'Admin' }]} currentUserId="another-user" />)
    expect(screen.getByText(/protected admin/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('button', { name: /archive account/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /deactivate account/i })).toBeDisabled()
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

  it('disables archive for the current user', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('button', { name: /archive account/i })).toBeDisabled()
  })

  it('invokes onSortChange when clicking a sortable column header', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    render(
      <UsersTable
        accounts={[account]}
        currentUserId="user-1"
        sort="created"
        direction="desc"
        onSortChange={onSortChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /sort by user/i }))
    expect(onSortChange).toHaveBeenCalledWith('name', 'asc')
  })
})
