import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { AuthContext } from '../../../features/auth/authSession.jsx'
import ReportsSection from './ReportsSection.jsx'
import { getReportSummary } from './reportsService.js'

vi.mock('./reportsService.js', async () => {
  const actual = await vi.importActual('./reportsService.js')
  return {
    ...actual,
    getReportSummary: vi.fn(),
  }
})

function reportPayload({ rows = [], summaryValue = '0 min' } = {}) {
  return {
    report: {
      summary: [{ id: 'downtime', label: 'Downtime', value: summaryValue, helper: 'Selected period' }],
      rows,
    },
  }
}

function reportRow(cause = 'Corrective Maintenance') {
  return {
    cause,
    sensor: 'S-03',
    events: 1,
    durationMinutes: 12,
    estimatedLoss: 28,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('ReportsSection request states', () => {
  beforeEach(() => {
    getReportSummary.mockReset()
  })

  it('shows an unavailable state on initial failure and retries the same query', async () => {
    const user = userEvent.setup()
    getReportSummary
      .mockRejectedValueOnce(new Error('Reports service is offline.'))
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow()] }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByRole('heading', { name: 'Unable to load this report' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Reports service is offline.')
    expect(screen.queryByText('No downtime rows found for this report range.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Corrective Maintenance')).toBeInTheDocument()
    expect(getReportSummary).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
  })

  it('treats a successful report with no rows as a valid empty result', async () => {
    getReportSummary.mockResolvedValue(reportPayload())

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('No downtime rows found for this report range.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unable to load this report' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
  })

  it('preserves same-query data as stale after refresh failure and gates export', async () => {
    const user = userEvent.setup()
    const refresh = deferred()
    getReportSummary
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow()], summaryValue: '12 min' }))
      .mockReturnValueOnce(refresh.promise)

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Corrective Maintenance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Refresh report' }))
    expect(screen.getByText('Refreshing report...')).toBeInTheDocument()
    expect(screen.getByText('Corrective Maintenance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()

    refresh.reject(new Error('Refresh failed.'))

    expect(await screen.findByText(/Report data is stale/i)).toHaveTextContent('Refresh failed.')
    expect(screen.getByText('Corrective Maintenance')).toBeInTheDocument()
    expect(screen.getByText(/Report data is stale/i).querySelector('time')).toHaveAttribute('dateTime')
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('does not display a previous range after a new-range failure', async () => {
    getReportSummary
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow('Old range cause')] }))
      .mockRejectedValueOnce(new Error('New range failed.'))

    renderWithAuth(<ReportsSection />)
    expect(await screen.findByText('Old range cause')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-01' } })

    expect(await screen.findByRole('heading', { name: 'Unable to load this report' })).toBeInTheDocument()
    expect(screen.queryByText('Old range cause')).not.toBeInTheDocument()
    expect(screen.queryByText('No downtime rows found for this report range.')).not.toBeInTheDocument()
  })

  it('ignores a late response from a superseded range', async () => {
    const firstRequest = deferred()
    const secondRequest = deferred()
    getReportSummary
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)

    renderWithAuth(<ReportsSection />)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-01' } })

    secondRequest.resolve(reportPayload({ rows: [reportRow('Current range cause')] }))
    expect(await screen.findByText('Current range cause')).toBeInTheDocument()

    firstRequest.resolve(reportPayload({ rows: [reportRow('Late old range cause')] }))
    await waitFor(() => {
      expect(screen.queryByText('Late old range cause')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Current range cause')).toBeInTheDocument()
  })

  it('does not reuse a prior token report after the active session changes', async () => {
    const nextSessionRequest = deferred()
    getReportSummary
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow('Prior session cause')] }))
      .mockReturnValueOnce(nextSessionRequest.promise)

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter>
            <ReportsSection />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))
    expect(await screen.findByText('Prior session cause')).toBeInTheDocument()

    view.rerender(renderTree('second-token'))

    expect(screen.queryByText('Prior session cause')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()

    nextSessionRequest.reject(new Error('Second session failed.'))
    expect(await screen.findByRole('heading', { name: 'Unable to load this report' })).toBeInTheDocument()
    expect(screen.queryByText('Prior session cause')).not.toBeInTheDocument()
  })
})
