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

vi.mock('../features/dashboard/reports/ReportsSection.jsx', () => ({
  default: () => <h1>Reports route content</h1>,
}))

vi.mock('../features/dashboard/settings/SettingsSection.jsx', () => ({
  default: () => <h1>Settings route content</h1>,
}))

describe('Analytics route and navigation access', () => {
  it('shows Analytics navigation only to the approved existing roles', () => {
    const analyticsItem = navItems.find((item) => item.to === '/dashboard/analytics')

    expect(analyticsItem?.roles).toEqual([
      'Admin',
      'Operation Manager',
      'Engineering Supervisor',
    ])
  })

  it('blocks Quality Control role from the direct Analytics route', async () => {
    renderWithAuth(<App />, {
      route: '/dashboard/analytics',
      authValue: { user: { id: 'qc-1', role: 'Quality Control' } },
    })

    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Analytics route content' })).not.toBeInTheDocument()
  })

  it('allows an approved role to open the direct Analytics route', async () => {
    renderWithAuth(<App />, {
      route: '/dashboard/analytics',
      authValue: { user: { id: 'manager-1', role: 'Operation Manager' } },
    })

    expect(await screen.findByRole('heading', { name: 'Analytics route content' })).toBeInTheDocument()
  })

  it('allows Admin to open Analytics as the Managing Director role', async () => {
    renderWithAuth(<App />, {
      route: '/dashboard/analytics',
      authValue: { user: { id: 'admin-1', role: 'Admin' } },
    })

    expect(await screen.findByRole('heading', { name: 'Analytics route content' })).toBeInTheDocument()
  })

  it('blocks the retired Managing Director role from the direct Analytics route', async () => {
    renderWithAuth(<App />, {
      route: '/dashboard/analytics',
      authValue: { user: { id: 'legacy-director-1', role: 'Managing Director' } },
    })

    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeInTheDocument()
  })

  it('blocks a direct Analytics route for a role outside the approved scope', async () => {
    renderWithAuth(<App />, {
      route: '/dashboard/analytics',
      authValue: { user: { id: 'supervisor-1', role: 'Production Supervisor' } },
    })

    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Analytics route content' })).not.toBeInTheDocument()
  })

  it('allows Admin and Engineering Supervisor to open Reports and blocks Production Supervisor', async () => {
    for (const role of ['Admin', 'Engineering Supervisor']) {
      const { unmount } = renderWithAuth(<App />, {
        route: '/dashboard/reports',
        authValue: { user: { id: `user-${role}`, role } },
      })
      expect(await screen.findByRole('heading', { name: 'Reports route content' })).toBeInTheDocument()
      unmount()
    }

    renderWithAuth(<App />, {
      route: '/dashboard/reports',
      authValue: { user: { id: 'supervisor-1', role: 'Production Supervisor' } },
    })
    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeInTheDocument()
  })

  it('shows Reports and Settings navigation to Engineering Supervisor and gates Settings route cleanly', async () => {
    const reportsItem = navItems.find((item) => item.to === '/dashboard/reports')
    const settingsItem = navItems.find((item) => item.to === '/dashboard/settings')

    expect(reportsItem?.roles).toEqual([
      'Admin',
      'Operation Manager',
      'Quality Control',
      'Engineering Supervisor',
    ])
    expect(settingsItem?.roles).toEqual([
      'Admin',
      'Engineering Supervisor',
    ])

    const { unmount } = renderWithAuth(<App />, {
      route: '/dashboard/settings',
      authValue: { user: { id: 'eng-1', role: 'Engineering Supervisor' } },
    })
    expect(await screen.findByRole('heading', { name: 'Settings route content' })).toBeInTheDocument()
    unmount()

    renderWithAuth(<App />, {
      route: '/dashboard/settings',
      authValue: { user: { id: 'op-1', role: 'Operation Manager' } },
    })
    expect(await screen.findByRole('heading', { name: 'You don’t have access' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settings route content' })).not.toBeInTheDocument()
  })
})
