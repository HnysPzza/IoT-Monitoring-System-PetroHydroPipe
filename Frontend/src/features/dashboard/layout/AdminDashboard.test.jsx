import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import { acknowledgeAlert, getAlerts, subscribeToAlerts } from '../alerts/alertsService.js'

vi.mock('../alerts/alertsService.js', () => ({
  acknowledgeAlert: vi.fn(),
  getAlerts: vi.fn(),
  subscribeToAlerts: vi.fn(),
}))

function activeAlert() {
  return {
    id: 'alert-1',
    severity: 'Critical',
    status: 'Active',
    title: 'Inside Filler downtime detected',
    message: 'S-04 Inside Filler has no pulse.',
  }
}

describe('AdminDashboard alerts', () => {
  beforeEach(() => {
    acknowledgeAlert.mockReset()
    getAlerts.mockReset()
    subscribeToAlerts.mockReset()
    subscribeToAlerts.mockReturnValue(() => {})
  })

  it('uses the route title as the dashboard level-one heading', async () => {
    getAlerts.mockResolvedValue({ alerts: [] })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('shows active alert count and acknowledges an alert without reloading the dashboard', async () => {
    const user = userEvent.setup()

    getAlerts.mockResolvedValue({ alerts: [activeAlert()] })
    acknowledgeAlert.mockResolvedValue({
      alert: {
        ...activeAlert(),
        status: 'Acknowledged',
        acknowledgedAt: '2026-06-11T00:00:00.000Z',
      },
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)

    expect(screen.getByText('S-04 Inside Filler has no pulse.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /acknowledge/i }))

    await waitFor(() => {
      expect(acknowledgeAlert).toHaveBeenCalledWith('test-token', 'alert-1')
    })
    expect(await screen.findByText('Acknowledged')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  it('keeps recovered active alerts visible until the user acknowledges them', async () => {
    const user = userEvent.setup()
    const recoveredAlert = {
      ...activeAlert(),
      metadata: {
        recoveryPending: true,
        recoveredAt: '2026-06-11T00:02:00.000Z',
      },
    }

    getAlerts.mockResolvedValue({ alerts: [recoveredAlert] })
    acknowledgeAlert.mockResolvedValue({
      alert: {
        ...recoveredAlert,
        status: 'Resolved',
        acknowledgedAt: '2026-06-11T00:03:00.000Z',
        resolvedAt: '2026-06-11T00:03:00.000Z',
      },
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)

    expect(screen.getByText('Recovered, waiting for acknowledgement')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /acknowledge/i }))

    await waitFor(() => {
      expect(screen.queryByText('Recovered, waiting for acknowledgement')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  it('closes the alerts dialog with Escape and returns focus to the bell', async () => {
    const user = userEvent.setup()

    getAlerts.mockResolvedValue({ alerts: [activeAlert()] })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)

    expect(screen.getByRole('dialog', { name: /active alerts/i })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /active alerts/i })).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
  })

  it('closes alerts before opening the mobile navigation drawer', async () => {
    const user = userEvent.setup()

    getAlerts.mockResolvedValue({ alerts: [activeAlert()] })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: /open alerts, 1 active/i }))
    await user.click(screen.getByRole('button', { name: /open navigation/i }))

    expect(screen.queryByRole('dialog', { name: /active alerts/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
  })
})
