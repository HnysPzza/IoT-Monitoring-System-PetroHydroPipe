import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AuditSection from './AuditSection.jsx'
import { getAuditLogs } from './auditService.js'

vi.mock('./auditService.js', () => ({
  getAuditLogs: vi.fn(),
}))

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

    expect(await screen.findByText('Login was successful.')).toBeInTheDocument()
    expect(screen.queryByText(/admin logged in/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(getAuditLogs).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 2, limit: 25 }))
    })
    await waitFor(() => {
      expect(screen.getAllByText(/user account created/i).length).toBeGreaterThan(1)
    })
  })

  it('uses a simplified table and shows readable details in a modal', async () => {
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

    expect(await screen.findByRole('columnheader', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Who did it' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Source' })).not.toBeInTheDocument()

    const detailsButton = await screen.findByRole('button', { name: /view details/i })

    await user.click(detailsButton)

    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).getByText('What happened')).toBeInTheDocument()
    expect(within(dialog).getByText(/outside filler wire downtime detected was created/i)).toBeInTheDocument()
    expect(within(dialog).getByText('Who did it')).toBeInTheDocument()
    expect(within(dialog).getAllByText('System')).toHaveLength(2)
    expect(within(dialog).getByText('Source')).toBeInTheDocument()
    expect(within(dialog).queryByText('Technical details')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Action code')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('event-1')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /close audit details/i }))
    expect(screen.queryByRole('dialog', { name: 'Audit details' })).not.toBeInTheDocument()
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

    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).getByText('Override reason')).toBeInTheDocument()
    expect(within(dialog).getByText('Maintenance confirmed normal operation')).toBeInTheDocument()
    expect(within(dialog).getByText('Admin')).toBeInTheDocument()
    expect(within(dialog).queryByText('admin')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Technical details')).not.toBeInTheDocument()
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
    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).getAllByText('Sensors')).toHaveLength(2)
    expect(within(dialog).getByText(/reported no pulse.*observation, not confirmed downtime/i)).toBeInTheDocument()
    expect(within(dialog).queryByText('No pulse observation (raw value: downtime)')).not.toBeInTheDocument()
  })
})
