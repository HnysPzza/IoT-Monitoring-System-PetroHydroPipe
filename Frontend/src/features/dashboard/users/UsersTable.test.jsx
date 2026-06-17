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

    await user.click(screen.getByRole('button', { name: /archive/i }))

    expect(onArchiveAccount).toHaveBeenCalledWith(account)
  })

  it('disables archive for the current user', () => {
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

    expect(screen.getByRole('button', { name: /archive/i })).toBeDisabled()
  })
})
