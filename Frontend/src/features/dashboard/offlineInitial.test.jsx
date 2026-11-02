import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../test/renderWithAuth.jsx'
import AnalyticsSection from './analytics/AnalyticsSection.jsx'
import AuditSection from './audit/AuditSection.jsx'
import ReportsSection from './reports/ReportsSection.jsx'

vi.mock('../../shared/hooks/useNetworkOnline.js', () => ({ useNetworkOnline: () => false }))

describe('first visit without a connection', () => {
  it.each([
    ['Analytics', <AnalyticsSection />],
    ['Reports', <ReportsSection />],
    ['Audit', <AuditSection />],
  ])('%s shows an offline notice and retry', (_, component) => {
    renderWithAuth(component)
    expect(screen.getByText(/unable to refresh while offline/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
