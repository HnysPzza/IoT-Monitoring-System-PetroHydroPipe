import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { AuthContext } from '../../../features/auth/authSession.jsx'
import ReportsSection from './ReportsSection.jsx'
import { exportReport, getReportSummary } from './reportsService.js'
import '../../../shared/components/ui/Calendar.jsx'

vi.mock('./reportsService.js', async () => {
  const actual = await vi.importActual('./reportsService.js')
  return {
    ...actual,
    exportReport: vi.fn(),
    getReportSummary: vi.fn(),
  }
})

function reportPayload({
  rows = [],
  processSensors = [],
  periodState = 'complete',
  estimatedLoss = 0,
  downtimeEvents = 6,
  downtimeMinutes = 38,
  outputPieces = 1250,
} = {}) {
  const isFuture = periodState === 'future'
  const summary = isFuture
    ? [
        { id: 'production', label: 'Production Count', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'process-events', label: 'Process Events', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'events', label: 'Downtime Events', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'duration', label: 'Downtime Duration', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'availability', label: 'Availability', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'loss', label: 'Estimated Loss', value: 'N/A', helper: 'Period not reached yet' },
      ]
    : [
        { id: 'production', label: 'Production Count', value: `${outputPieces.toLocaleString('en-PH')} pcs`, helper: 'From Spiral Mill 01' },
        { id: 'process-events', label: 'Process Events', value: '12', helper: 'From S-01, S-02, and S-04 pulses' },
        { id: 'events', label: 'Downtime Events', value: String(downtimeEvents), helper: 'Open and resolved events' },
        { id: 'duration', label: 'Downtime Duration', value: `${downtimeMinutes} min`, helper: 'Unplanned minutes' },
        { id: 'availability', label: 'Availability', value: '92%', helper: 'Based on eligible production time' },
        { id: 'loss', label: 'Estimated Loss', value: `${estimatedLoss} pcs`, helper: 'Using 3 pcs/hr' },
      ]

  return {
    report: {
      generatedAt: '2026-08-31T04:00:00.000Z',
      lossEstimateBasis: {
        source: 'configured-fallback',
        ratePiecesPerMinute: 0.05,
        windowStartAt: '2026-07-31T16:00:00.000Z',
        windowEndAt: '2026-08-30T16:00:00.000Z',
        qualifiedProductionDays: 2,
        productiveMinutes: 240,
        outputPieces: 8,
      },
      summary,
      periodState,
      metrics: {
        outputPieces: isFuture ? null : outputPieces,
        durationMinutes: isFuture ? null : downtimeMinutes,
        downtimeEventCount: isFuture ? null : downtimeEvents,
        availabilityPercent: isFuture ? null : 92,
        estimatedLoss: isFuture ? null : estimatedLoss,
      },
      comparison: isFuture ? null : {
        periodState: 'complete',
        metrics: {
          outputPieces: 1000,
          availabilityPercent: 90,
          estimatedLoss: 2,
        },
      },
      processSensors,
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

async function selectExportFormat(user, format) {
  await user.click(await screen.findByRole('button', { name: 'Export report' }))
  await user.click(await screen.findByRole('button', { name: `Export ${format.toUpperCase()}` }))
}

async function selectReportDate(user, dateName) {
  await user.click(screen.getByRole('button', { name: /selected period/i }))
  await screen.findByRole('dialog')
  if (!screen.queryByRole('button', { name: dateName })) {
    await user.click(await screen.findByRole('button', { name: /previous month/i }))
  }
  await user.click(await screen.findByRole('button', { name: dateName }))
}

describe('ReportsSection request states', () => {
  beforeEach(() => {
    getReportSummary.mockReset()
    exportReport.mockReset()
  })

  it('shows the process-event breakdown returned by the report API', async () => {
    getReportSummary.mockResolvedValue(reportPayload({
      processSensors: [{ sensorCode: 'S-01', eventCount: 7 }],
    }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('S-01 - Raw Material & Coil Joint')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('renders three primary cards and one merged Downtime card', async () => {
    getReportSummary.mockResolvedValue(reportPayload({
      processSensors: [{ sensorCode: 'S-01', eventCount: 7 }],
    }))

    const { container } = renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Production Count')).toBeInTheDocument()
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByTestId('report-card-loss')).toHaveTextContent('Estimated Loss')
    expect(screen.getByTestId('report-card-downtime')).toHaveClass('reports-downtime-card')
    expect(screen.getByText('6 events · 38 min')).toBeInTheDocument()
    expect(screen.getByText('Open and resolved, unplanned')).toBeInTheDocument()
    expect(screen.queryByText('Downtime Events')).not.toBeInTheDocument()
    expect(screen.queryByText('Downtime Duration')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-card-process-events')).not.toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(4)
    expect(document.querySelectorAll('.reports-primary-card')).toHaveLength(3)
    expect(screen.getAllByTestId('report-delta')).toHaveLength(3)
    expect(container.querySelector('.reports-period-toggle')).toHaveClass('trend-mode-toggle')
    expect(container.querySelector('.reports-controls-actions')).toBeInTheDocument()
    expect(container.querySelector('.reports-controls .reports-icon-button[aria-label="Refresh report"]')).toBeInTheDocument()
  })

  it('marks non-zero Estimated Loss as a warning while zero stays neutral', async () => {
    getReportSummary.mockResolvedValue(reportPayload({ estimatedLoss: 4 }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByTestId('report-card-loss')).toHaveClass('reports-card-warning')
    expect(screen.getByTestId('report-card-loss')).toHaveTextContent('4 pcs')
  })

  it('uses visible period segments and an adaptive calendar control', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(reportPayload())

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monthly' })).toBeInTheDocument()
    expect(screen.queryByText('Daily summary')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    await user.click(screen.getByRole('button', { name: /selected period/i }))
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Select chart week')
    expect(getReportSummary).toHaveBeenCalledWith('test-token', expect.objectContaining({
      reportType: 'weekly',
      includeComparison: true,
    }))
  })

  it('exports CSV through the server endpoint and downloads the returned file', async () => {
    const user = userEvent.setup()
    const downloads = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloads.push({ download: this.download, href: this.href })
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    getReportSummary.mockResolvedValue(reportPayload({ rows: [reportRow()] }))
    exportReport.mockResolvedValue({
      blob: new Blob(['cause,sensor\nCorrective Maintenance,S-03\n'], { type: 'text/csv' }),
      filename: 'report-daily-2026-09-02.csv',
    })

    renderWithAuth(<ReportsSection />)
    await selectExportFormat(user, 'csv')

    await waitFor(() => {
      expect(downloads).toHaveLength(1)
    })
    expect(downloads[0].download).toBe('report-daily-2026-09-02.csv')
    expect(downloads[0].href).toBe('blob:report')

    expect(exportReport).toHaveBeenCalledTimes(1)
    expect(exportReport).toHaveBeenCalledWith('test-token', expect.objectContaining({
      reportType: 'daily',
      format: 'csv',
    }))
    expect(exportReport.mock.calls[0][1].selectedDate).toEqual(expect.any(String))
    vi.unstubAllGlobals()
  })

  it('exports PDF through the same server endpoint', async () => {
    const user = userEvent.setup()
    const downloads = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloads.push({ download: this.download, href: this.href })
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report-pdf')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    getReportSummary.mockResolvedValue(reportPayload({ rows: [reportRow()] }))
    exportReport.mockResolvedValue({
      blob: new Blob(['%PDF-x'], { type: 'application/pdf' }),
      filename: 'report-daily-2026-09-02.pdf',
    })

    renderWithAuth(<ReportsSection />)
    await selectExportFormat(user, 'pdf')

    await waitFor(() => {
      expect(downloads).toHaveLength(1)
    })
    expect(downloads[0].download).toBe('report-daily-2026-09-02.pdf')
    expect(exportReport).toHaveBeenCalledWith('test-token', expect.objectContaining({
      reportType: 'daily',
      format: 'pdf',
    }))
    vi.unstubAllGlobals()
  })

  it('surfaces export failures without discarding the loaded report', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(reportPayload({ rows: [reportRow()] }))
    exportReport.mockRejectedValue(new Error('Too many export requests. Please try again later.'))

    renderWithAuth(<ReportsSection />)
    await selectExportFormat(user, 'csv')

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many export requests. Please try again later.')
    expect(screen.getByText('Corrective Maintenance')).toBeInTheDocument()
  })

  it('labels partial reports and prevents choosing a future date', async () => {
    getReportSummary.mockResolvedValue(reportPayload({ periodState: 'partial' }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText(/Partial report/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /selected period/i })).toBeInTheDocument()
  })

  it('renders future report values as unobserved and blocks export', async () => {
    getReportSummary.mockResolvedValue(reportPayload({
      periodState: 'future',
      processSensors: [{ sensorCode: 'S-01', eventCount: null }],
    }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Period not reached yet. No values have been observed.')).toBeInTheDocument()
    expect(screen.getAllByText('Not observed').length).toBeGreaterThan(0)
    expect(screen.getByText('Downtime not observed yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Corrective Maintenance')).toBeInTheDocument()
    expect(getReportSummary).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Export report' })).toBeEnabled()
  })

  it('treats a successful report with no rows as a valid empty result', async () => {
    getReportSummary.mockResolvedValue(reportPayload())

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('No downtime rows found for this report range.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unable to load this report' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).toBeEnabled()
  })

  it('preserves same-query data as stale after refresh failure and gates export', async () => {
    const user = userEvent.setup()
    const refresh = deferred()
    getReportSummary
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow()] }))
      .mockReturnValueOnce(refresh.promise)

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Corrective Maintenance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Refresh report' }))
    expect(screen.getByText('Refreshing report...')).toBeInTheDocument()
    expect(screen.getByText('Corrective Maintenance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()

    refresh.reject(new Error('Refresh failed.'))

    expect(await screen.findByText(/Report data is stale/i)).toHaveTextContent('Refresh failed.')
    expect(screen.getByText('Corrective Maintenance')).toBeInTheDocument()
    expect(screen.getByText(/Report data is stale/i).querySelector('time')).toHaveAttribute('dateTime')
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()
  })

  it('does not display a previous range after a new-range failure', async () => {
    getReportSummary
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow('Old range cause')] }))
      .mockRejectedValueOnce(new Error('New range failed.'))

    renderWithAuth(<ReportsSection />)
    expect(await screen.findByText('Old range cause')).toBeInTheDocument()

    await selectReportDate(userEvent.setup(), /august 1st, 2026/i)
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
    await selectReportDate(userEvent.setup(), /august 1st, 2026/i)

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
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()

    nextSessionRequest.reject(new Error('Second session failed.'))
    expect(await screen.findByRole('heading', { name: 'Unable to load this report' })).toBeInTheDocument()
    expect(screen.queryByText('Prior session cause')).not.toBeInTheDocument()
  })
})
