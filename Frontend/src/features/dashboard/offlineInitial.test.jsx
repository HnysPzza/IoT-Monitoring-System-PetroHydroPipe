import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../test/renderWithAuth.jsx'
import AnalyticsSection from './analytics/AnalyticsSection.jsx'
import AuditSection from './audit/AuditSection.jsx'
import ReportsSection from './reports/ReportsSection.jsx'
import DowntimeSection from './downtime/DowntimeSection.jsx'
import ProductionSection from './production/ProductionSection.jsx'
import SettingsSection from './settings/SettingsSection.jsx'
import UsersSection from './users/UsersSection.jsx'
import UsersActionProvider from './users/UsersActionProvider.jsx'
import DashboardSection from './overview/DashboardSection.jsx'

beforeEach(() => onlineManager.setOnline(false))
afterEach(() => { cleanup(); act(() => onlineManager.setOnline(true)) })

describe('first visit without a connection', () => {
  it.each([
    ['Analytics', <AnalyticsSection />],
    ['Reports', <ReportsSection />],
    ['Audit', <AuditSection />],
    ['Downtime', <DowntimeSection />],
    ['Production', <ProductionSection />],
    ['Settings', <SettingsSection />],
    ['Users', <UsersActionProvider><UsersSection /></UsersActionProvider>],
  ])('%s shows an offline notice and retry', (_, component) => {
    renderWithAuth(component)
    expect(screen.getByText(/unable to refresh while offline/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows offline errors for overview and chart instead of skeletons', () => {
    renderWithAuth(<DashboardSection />)
    expect(screen.getAllByText(/unable to refresh while offline/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /retry overview/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry chart/i })).toBeInTheDocument()
  })

  it('loads production data automatically after reconnecting', async () => {
    const loadProduction = vi.fn().mockResolvedValue({ records: [], summary: {}, pagination: {} })
    renderWithAuth(<ProductionSection loadProduction={loadProduction} />)
    expect(loadProduction).not.toHaveBeenCalled()
    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(loadProduction).toHaveBeenCalled())
    expect(screen.queryByText(/unable to refresh while offline/i)).not.toBeInTheDocument()
  })
})
