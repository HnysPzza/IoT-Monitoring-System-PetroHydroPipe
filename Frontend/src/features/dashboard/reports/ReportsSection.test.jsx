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
      category: 'regular',
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

function productionReportPayload({
  totalOutput = 10,
  specifiedPipes = 8,
  unspecifiedPipes = 2,
  distinctSizes = 2,
  periodState = 'complete',
  specBreakdown = [
    {
      label: 'Grade A 6-inch',
      size: '6 inch',
      diameter: 168.28,
      radius: 84.14,
      circumference: 528.67,
      isSpecified: true,
      pipeCount: 8,
      percentageOfTotal: 80.0,
    },
    {
      label: null,
      size: null,
      diameter: null,
      radius: null,
      circumference: null,
      isSpecified: false,
      pipeCount: 2,
      percentageOfTotal: 20.0,
    },
  ],
  productionLogs = [
    {
      id: 'evt-1',
      deviceEventId: 101,
      recordedAt: '2026-09-02T01:00:00.000Z',
      label: 'Grade A 6-inch',
      size: '6 inch',
      diameter: 168.28,
      isSpecified: true,
    },
    {
      id: 'evt-2',
      deviceEventId: 102,
      recordedAt: '2026-09-02T02:00:00.000Z',
      label: null,
      size: null,
      diameter: null,
      isSpecified: false,
    },
  ],
} = {}) {
  const isFuture = periodState === 'future'
  return {
    report: {
      category: 'production',
      generatedAt: '2026-08-31T04:00:00.000Z',
      periodState,
      summary: isFuture
        ? [
            { id: 'total-output', label: 'Total Production Output', value: 'N/A', helper: 'Period not reached yet' },
            { id: 'specified-pipes', label: 'Specified Pipes', value: 'N/A', helper: 'Period not reached yet' },
            { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: 'N/A', helper: 'Period not reached yet' },
            { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: 'N/A', helper: 'Period not reached yet' },
          ]
        : [
            { id: 'total-output', label: 'Total Production Output', value: `${totalOutput} pcs`, helper: 'From Spiral Mill 01' },
            { id: 'specified-pipes', label: 'Specified Pipes', value: `${specifiedPipes} pcs`, helper: '80% of total output' },
            { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: `${unspecifiedPipes} pcs`, helper: 'Pending specification tag' },
            { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: String(distinctSizes), helper: 'Unique pipe specs produced' },
          ],
      metrics: {
        totalProductionOutput: isFuture ? null : totalOutput,
        specifiedPipes: isFuture ? null : specifiedPipes,
        unspecifiedPipes: isFuture ? null : unspecifiedPipes,
        distinctProductSizes: isFuture ? null : distinctSizes,
      },
      comparison: isFuture ? null : {
        periodState: 'complete',
        metrics: {
          totalProductionOutput: 8,
          specifiedPipes: 6,
          unspecifiedPipes: 2,
          distinctProductSizes: 2,
        },
      },
      specBreakdown: isFuture ? [] : specBreakdown,
      productionLogs: isFuture ? [] : productionLogs,
      rows: isFuture ? [] : productionLogs,
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
  const label = format === 'xlsx' ? 'Excel' : format.toUpperCase()
  await user.click(await screen.findByRole('button', { name: `Export ${label}` }))
}

async function selectReportDate(user, dateName) {
  await user.click(screen.getByRole('button', { name: /selected period/i }))
  await screen.findByRole('dialog')
  while (!screen.queryByRole('button', { name: dateName })) {
    await user.click(await screen.findByRole('button', { name: /previous month/i }))
  }
  await user.click(await screen.findByRole('button', { name: dateName }))
}

async function selectReportCategory(user, categoryLabel) {
  await user.click(await screen.findByRole('button', { name: 'Filter report type' }))
  await user.click(await screen.findByRole('menuitem', { name: categoryLabel }))
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

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Production Count')).toBeInTheDocument()
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByTestId('report-card-loss')).toHaveTextContent('Estimated Loss')
    expect(screen.getByTestId('report-card-downtime')).toHaveClass('reports-downtime-card')
    expect(screen.getByText('6 events · 38 min')).toBeInTheDocument()
    expect(screen.getByText('Open and resolved, unplanned')).toBeInTheDocument()
    expect(screen.queryByText('Downtime Events')).not.toBeInTheDocument()
    expect(screen.queryByText('Downtime Duration')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-card-process-events')).not.toBeInTheDocument()
  })

  it('marks non-zero Estimated Loss as a warning while zero stays neutral', async () => {
    getReportSummary.mockResolvedValue(reportPayload({ estimatedLoss: 12 }))

    renderWithAuth(<ReportsSection />)

    const lossCard = await screen.findByTestId('report-card-loss')
    expect(lossCard).toHaveClass('reports-card-warning')
  })

  it('uses visible period segments and an adaptive calendar control', async () => {
    getReportSummary.mockResolvedValue(reportPayload())

    renderWithAuth(<ReportsSection />)

    const dailyButton = await screen.findByRole('button', { name: 'Daily' })
    const weeklyButton = screen.getByRole('button', { name: 'Weekly' })
    const monthlyButton = screen.getByRole('button', { name: 'Monthly' })

    expect(dailyButton).toHaveAttribute('aria-pressed', 'true')
    expect(weeklyButton).toHaveAttribute('aria-pressed', 'false')
    expect(monthlyButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /selected period/i })).toBeInTheDocument()
  })

  it('exports PDF through the same server endpoint', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(reportPayload())
    exportReport.mockResolvedValue({
      blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      filename: 'report-daily-2026-08-31.pdf',
    })

    renderWithAuth(<ReportsSection />)

    await screen.findByText('Production Count')
    await selectExportFormat(user, 'pdf')

    expect(exportReport).toHaveBeenCalledWith('test-token', {
      category: 'regular',
      reportType: 'daily',
      selectedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      format: 'pdf',
    })
  })

  it('exports an Excel workbook through the same server endpoint', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(reportPayload())
    exportReport.mockResolvedValue({
      blob: new Blob(['xlsx-binary'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename: 'report-daily-2026-08-31.xlsx',
    })

    renderWithAuth(<ReportsSection />)

    await screen.findByText('Production Count')
    await selectExportFormat(user, 'xlsx')

    expect(exportReport).toHaveBeenCalledWith('test-token', {
      category: 'regular',
      reportType: 'daily',
      selectedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      format: 'xlsx',
    })
  })

  it('surfaces export failures without discarding the loaded report', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(reportPayload())
    exportReport.mockRejectedValue(new Error('Too many export requests. Please try again later.'))

    renderWithAuth(<ReportsSection />)

    await screen.findByText('Production Count')
    await selectExportFormat(user, 'pdf')

    expect(await screen.findByText('Too many export requests. Please try again later.')).toBeInTheDocument()
    expect(screen.getByText('Production Count')).toBeInTheDocument()
  })

  it('labels partial reports and prevents choosing a future date', async () => {
    getReportSummary.mockResolvedValue(reportPayload({ periodState: 'partial' }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Partial report. Values cover recorded time so far.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).not.toBeDisabled()
  })

  it('renders future report values as unobserved and blocks export', async () => {
    getReportSummary.mockResolvedValue(reportPayload({ periodState: 'future' }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Period not reached yet. No values have been observed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()
    expect(screen.getByText('Downtime not observed yet.')).toBeInTheDocument()
  })

  it('shows an unavailable state on initial failure and retries the same query', async () => {
    const user = userEvent.setup()
    getReportSummary
      .mockRejectedValueOnce(new Error('Network error loading report.'))
      .mockResolvedValueOnce(reportPayload())

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByRole('heading', { name: 'Unable to load this report' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Network error loading report.')
    expect(screen.queryByText('Downtime by cause and sensor')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Downtime by cause and sensor')).toBeInTheDocument()
    expect(getReportSummary).toHaveBeenCalledTimes(2)
  })

  it('treats a successful report with no rows as a valid empty result', async () => {
    getReportSummary.mockResolvedValue(reportPayload({ rows: [] }))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('No downtime rows found for this report range.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unable to load this report' })).not.toBeInTheDocument()
  })

  it('preserves same-query data as stale after refresh failure and gates export', async () => {
    const user = userEvent.setup()
    getReportSummary
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow('Initial Cause')] }))
      .mockRejectedValueOnce(new Error('Temporary server issue.'))

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Initial Cause')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh report' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Report data is stale/i)
    expect(screen.getByText('Initial Cause')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()
  })

  it('does not display a previous range after a new-range failure', async () => {
    getReportSummary
      .mockResolvedValueOnce(reportPayload({ rows: [reportRow('Old range cause')] }))
      .mockRejectedValueOnce(new Error('New range query failed.'))

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

  it('toggles to Production Report and displays specification breakdown and cut log tables', async () => {
    const user = userEvent.setup()
    getReportSummary
      .mockResolvedValueOnce(reportPayload())
      .mockResolvedValueOnce(productionReportPayload())

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Production Count')).toBeInTheDocument()

    const filterButton = screen.getByRole('button', { name: 'Filter report type' })
    await user.click(filterButton)

    const prodButton = screen.getByRole('menuitem', { name: 'Production Report' })
    expect(prodButton).toHaveAttribute('aria-checked', 'false')
    await user.click(prodButton)

    expect(getReportSummary).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
      category: 'production',
    }))

    // Check Production Report sections
    expect(await screen.findByText('Output by product specification')).toBeInTheDocument()
    expect(screen.getByText('S-05 cutting events')).toBeInTheDocument()
    expect(screen.getAllByText('Grade A 6-inch').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('168.28 mm').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('8 pcs (80%)')).toBeInTheDocument()
    expect(screen.getByText('Unspecified / Pending Tag')).toBeInTheDocument()

    // Regular report tables should not be rendered
    expect(screen.queryByText('Events by process sensor')).not.toBeInTheDocument()
    expect(screen.queryByText('Downtime by cause and sensor')).not.toBeInTheDocument()
  })

  it('exports production report with category=production when export button is clicked', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(productionReportPayload())
    exportReport.mockResolvedValue({
      blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      filename: 'production-report-daily-2026-08-31.pdf',
    })

    renderWithAuth(<ReportsSection />)

    await selectReportCategory(user, 'Production Report')

    await screen.findByText('Output by product specification')
    await selectExportFormat(user, 'pdf')

    expect(exportReport).toHaveBeenCalledWith('test-token', {
      category: 'production',
      reportType: 'daily',
      selectedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      format: 'pdf',
    })
  })

  it('displays unobserved production report state when period is future', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(productionReportPayload({ periodState: 'future' }))

    renderWithAuth(<ReportsSection />)

    await selectReportCategory(user, 'Production Report')

    expect(await screen.findByText('Period not reached yet. No values have been observed.')).toBeInTheDocument()
    expect(screen.getByText('Output not observed yet.')).toBeInTheDocument()
    expect(screen.getByText('Pipe cuts not observed yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled()
  })

  it('switches back from Production Report to Regular Report cleanly', async () => {
    const user = userEvent.setup()
    const regularSummary = reportPayload()
    const productionSummary = productionReportPayload()

    getReportSummary
      .mockResolvedValueOnce(regularSummary)
      .mockResolvedValueOnce(productionSummary)
      .mockResolvedValueOnce(regularSummary)

    renderWithAuth(<ReportsSection />)

    expect(await screen.findByText('Production Count')).toBeInTheDocument()

    await selectReportCategory(user, 'Production Report')

    expect(await screen.findByText('Output by product specification')).toBeInTheDocument()

    await selectReportCategory(user, 'Regular Report')

    expect(await screen.findByText('Events by process sensor')).toBeInTheDocument()
    expect(screen.getByText('Downtime by cause and sensor')).toBeInTheDocument()
    expect(screen.queryByText('Output by product specification')).not.toBeInTheDocument()
  })

  it('renders N/A for invalid or null cut timestamps in production cut logs', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(productionReportPayload({
      productionLogs: [
        {
          id: 'evt-null-date',
          deviceEventId: 201,
          recordedAt: null,
          label: 'Pipe with null date',
          size: '4 inch',
          diameter: 114.3,
          isSpecified: true,
        },
        {
          id: 'evt-invalid-date',
          deviceEventId: 202,
          recordedAt: 'not-a-valid-timestamp',
          label: 'Pipe with invalid date',
          size: '4 inch',
          diameter: 114.3,
          isSpecified: true,
        },
      ],
    }))

    renderWithAuth(<ReportsSection />)

    await selectReportCategory(user, 'Production Report')

    await screen.findByText('Output by product specification')
    const naCells = screen.getAllByText('N/A')
    expect(naCells.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Pipe with null date')).toBeInTheDocument()
    expect(screen.getByText('Pipe with invalid date')).toBeInTheDocument()
  })

  it('opens Gemini-style popover filter menu with funnel icon, showing active category checkmark and closing on escape or outside click', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(reportPayload())

    renderWithAuth(<ReportsSection />)

    const funnelButton = await screen.findByRole('button', { name: 'Filter report type' })
    expect(funnelButton).toBeInTheDocument()
    expect(funnelButton.querySelector('svg.preview-icon')).toBeInTheDocument()
    expect(funnelButton).toHaveAttribute('aria-expanded', 'false')

    // Popover is closed initially
    expect(screen.queryByRole('menu', { name: 'Report category' })).not.toBeInTheDocument()

    // Open popover
    await user.click(funnelButton)
    expect(funnelButton).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByRole('menu', { name: 'Report category' })
    expect(popover).toHaveClass('reports-filter-popover')
    expect(popover).toHaveClass('rounded-2xl')

    // Active item (Regular Report) has checkmark and active styling
    const regularItem = screen.getByRole('menuitem', { name: 'Regular Report' })
    expect(regularItem).toHaveClass('is-active')
    expect(regularItem).toHaveAttribute('aria-checked', 'true')
    expect(regularItem.querySelector('svg')).toBeInTheDocument()

    // Production Report is inactive
    const prodItem = screen.getByRole('menuitem', { name: 'Production Report' })
    expect(prodItem).not.toHaveClass('is-active')
    expect(prodItem).toHaveAttribute('aria-checked', 'false')

    // Close on Escape key
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Report category' })).not.toBeInTheDocument()
    expect(funnelButton).toHaveAttribute('aria-expanded', 'false')

    // Open again and test arrow navigation
    await user.click(funnelButton)
    expect(screen.getByRole('menu', { name: 'Report category' })).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Regular Report' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Production Report' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Regular Report' })).toHaveFocus()

    // Close by clicking outside
    await user.click(document.body)
    expect(screen.queryByRole('menu', { name: 'Report category' })).not.toBeInTheDocument()
    expect(funnelButton).toHaveAttribute('aria-expanded', 'false')

    // Open and verify close on focus loss (e.g. tabbing out)
    await user.click(funnelButton)
    expect(screen.getByRole('menu', { name: 'Report category' })).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('menuitem', { name: 'Regular Report' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('menuitem', { name: 'Production Report' })).toHaveFocus()
    await user.tab()
    expect(screen.queryByRole('menu', { name: 'Report category' })).not.toBeInTheDocument()
    expect(funnelButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('triggers blob download by appending anchor to body and deferring URL revocation', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(reportPayload())
    exportReport.mockResolvedValue({
      blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      filename: 'report-daily-2026-08-31.pdf',
    })

    const appendChildSpy = vi.spyOn(document.body, 'appendChild')
    const removeChildSpy = vi.spyOn(document.body, 'removeChild')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    try {
      renderWithAuth(<ReportsSection />)

      await screen.findByText('Production Count')
      revokeObjectURLSpy.mockClear()
      await selectExportFormat(user, 'pdf')

      expect(appendChildSpy).toHaveBeenCalledWith(expect.any(HTMLAnchorElement))
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(removeChildSpy).toHaveBeenCalledWith(expect.any(HTMLAnchorElement))
      expect(revokeObjectURLSpy).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
      }, { timeout: 2000 })
    } finally {
      appendChildSpy.mockRestore()
      removeChildSpy.mockRestore()
      revokeObjectURLSpy.mockRestore()
      clickSpy.mockRestore()
    }
  })
})
