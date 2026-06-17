import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AuditSection from './AuditSection.jsx'
import { getAuditLogs } from './auditService.js'

vi.mock('./auditService.js', () => ({
  getAuditLogs: vi.fn(),
}))

describe('AuditSection', () => {
  beforeEach(() => {
    getAuditLogs.mockReset()
  })

  it('loads audit logs and requests the next page from the backend', async () => {
    const user = userEvent.setup()

    getAuditLogs
      .mockResolvedValueOnce({
        logs: [{ id: 'audit-1', action: 'LOGIN_SUCCESS', entityType: 'auth', createdAt: '2026-06-11T00:00:00.000Z', actor: { username: 'admin', role: 'Admin' }, metadata: {} }],
        pagination: { page: 1, limit: 25, total: 30, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
      })
      .mockResolvedValueOnce({
        logs: [{ id: 'audit-2', action: 'USER_CREATED', entityType: 'user', createdAt: '2026-06-12T00:00:00.000Z', actor: { username: 'admin', role: 'Admin' }, metadata: { targetUsername: 'operator01' } }],
        pagination: { page: 2, limit: 25, total: 30, totalPages: 2, hasNextPage: false, hasPreviousPage: true },
      })

    renderWithAuth(<AuditSection />)

    expect(await screen.findByText(/successful login/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(getAuditLogs).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 2, limit: 25 }))
    })
    await waitFor(() => {
      expect(screen.getAllByText(/user account created/i).length).toBeGreaterThan(1)
    })
  })
})
