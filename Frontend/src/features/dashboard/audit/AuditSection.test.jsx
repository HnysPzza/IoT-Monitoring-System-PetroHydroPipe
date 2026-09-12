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

  it('shows readable inline details before technical audit data', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [
        {
          id: 'audit-1',
          action: 'ALERT_CREATED',
          entityType: 'sensor',
          entityId: 'sensor-1',
          createdAt: '2026-06-11T00:00:00.000Z',
          actor: null,
          metadata: {
            title: 'Outside Filler Wire downtime detected',
            sensorCode: 'S-04',
            signal: 'no_pulse',
            eventId: 'event-1',
          },
        },
      ],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)

    const detailsButton = await screen.findByRole('button', { name: /view details/i })

    await user.click(detailsButton)

    expect(screen.getByText('Readable details')).toBeInTheDocument()
    expect(screen.getByText('What happened')).toBeInTheDocument()
    expect(screen.getAllByText(/outside filler wire downtime detected was created/i).length).toBeGreaterThan(1)
    expect(screen.queryByText('Action code')).not.toBeInTheDocument()
    expect(screen.queryByText('event-1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show technical details/i }))

    expect(screen.getByText('Action code')).toBeInTheDocument()
    expect(screen.getByText('ALERT_CREATED')).toBeInTheDocument()
    expect(screen.getByText('Event ID')).toBeInTheDocument()
    expect(screen.getByText('event-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /hide details/i }))

    expect(screen.queryByText('Readable details')).not.toBeInTheDocument()
  })

  it('shows manual recovery reason in readable details', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [{
        id: 'audit-override',
        action: 'SENSOR_MANUAL_RECOVERY_OVERRIDE',
        entityType: 'sensor',
        entityId: 'sensor-4',
        createdAt: '2026-08-31T01:00:00.000Z',
        actor: { username: 'admin', role: 'Admin' },
        metadata: {
          sensorCode: 'S-04',
          machineName: 'Spiral Mill 01',
          newMachineStatus: 'Running',
          reason: 'Maintenance confirmed normal operation',
        },
      }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)
    await user.click(await screen.findByRole('button', { name: /view details/i }))

    expect(screen.getByText('Override reason')).toBeInTheDocument()
    expect(screen.getByText('Maintenance confirmed normal operation')).toBeInTheDocument()
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument()
  })

  it('describes no-pulse sensor input as an observation instead of confirmed downtime', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [{
        id: 'audit-no-pulse',
        action: 'IOT_EVENT_RECEIVED',
        entityType: 'sensor_event',
        entityId: 'event-no-pulse',
        createdAt: '2026-09-09T07:11:08.000Z',
        actor: null,
        metadata: {
          deviceId: 'esp32-m01-s02',
          sensorCode: 'S-02',
          eventType: 'downtime',
          signal: 'no_pulse',
          watchdogObservation: true,
        },
      }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)

    expect(await screen.findByText(/reported no pulse.*observation, not confirmed downtime/i)).toBeInTheDocument()
    expect(screen.queryByText(/detected downtime/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view details/i }))
    await user.click(screen.getByRole('button', { name: /show technical details/i }))

    expect(screen.getByText('No pulse observation (raw value: downtime)')).toBeInTheDocument()
  })
})
