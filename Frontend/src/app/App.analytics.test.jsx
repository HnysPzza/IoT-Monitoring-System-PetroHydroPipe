import { screen } from '@testing-library/react'
import { Outlet } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../test/renderWithAuth.jsx'
import { navItems } from '../shared/constants/dashboardMeta.js'
import App from './App.jsx'

vi.mock('../features/dashboard/layout/AdminDashboard.jsx', () => ({
  default: () => <Outlet />,
}))

vi.mock('../features/dashboard/analytics/AnalyticsSection.jsx', () => ({
  default: () => <h1>Analytics route content</h1>,
}))

describe('Analytics route and navigation access', () => {
  it('shows Analytics navigation only to the approved existing roles', () => {
    const analyticsItem = navItems.find((item) => item.to === '/dashboard/analytics')

    expect(analyticsItem?.roles).toEqual([
      'Admin',
      'Operation Manager',
      'Asst. Operation Manager',
      'Engineering Supervisor',
    ])
  })

  it('allows an approved role to open the direct Analytics route', async () => {
    renderWithAuth(<App />, {
      route: '/dashboard/analytics',
      authValue: { user: { id: 'manager-1', role: 'Operation Manager' } },
    })

    expect(await screen.findByRole('heading', { name: 'Analytics route content' })).toBeInTheDocument()
  })

  it('blocks a direct Analytics route for a role outside the approved scope', async () => {
    renderWithAuth(<App />, {
      route: '/dashboard/analytics',
      authValue: { user: { id: 'supervisor-1', role: 'Production Supervisor' } },
    })

    expect(await screen.findByRole('heading', { name: 'You do not have permission' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Analytics route content' })).not.toBeInTheDocument()
  })
})
