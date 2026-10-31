import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { getReportSummary, exportReport } from './reportsService.js'
import {
  formatDimension,
  formatTonnage,
  formatPercentage,
  getReportCards,
  getReportDelta,
} from './reportsPresentation.js'
import ReportsSection from './ReportsSection.jsx'

vi.mock('./reportsService.js', async () => {
  const actual = await vi.importActual('./reportsService.js')
  return {
    ...actual,
    exportReport: vi.fn(),
    getReportSummary: vi.fn(),
  }
})

async function openFilterAndSelectProduction(user) {
  const filterBtn = screen.getByRole('button', { name: /filter report type/i })
  await user.click(filterBtn)
  const prodItem = await screen.findByRole('menuitem', { name: 'Production Report' })
  await user.click(prodItem)
}

function createBaseReportPayload({
  category = 'production',
  periodState = 'complete',
  totalOutput = 10,
  specifiedPipes = 8,
  unspecifiedPipes = 2,
  totalTonnage = 9.2104,
  specBreakdown = [],
  productionLogs = [],
} = {}) {
  const isFuture = periodState === 'future'
  return {
    report: {
      category,
      generatedAt: '2026-10-31T04:00:00.000Z',
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
            { id: 'total-tonnage', label: 'Total Production Tonnage (tons)', value: `${totalTonnage.toFixed(4)} tons`, helper: 'Calculated metric tons' },
            { id: 'specified-pipes', label: 'Specified Pipes', value: `${specifiedPipes} pcs`, helper: '80% of total output' },
            { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: `${unspecifiedPipes} pcs`, helper: 'Pending specification tag' },
            { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: '2', helper: 'Unique pipe specs produced' },
          ],
      metrics: {
        totalProductionOutput: isFuture ? null : totalOutput,
        totalTonnage: isFuture ? null : totalTonnage,
        specifiedPipes: isFuture ? null : specifiedPipes,
        unspecifiedPipes: isFuture ? null : unspecifiedPipes,
        distinctProductSizes: isFuture ? null : 2,
      },
      specBreakdown: isFuture ? [] : specBreakdown,
      productionLogs: isFuture ? [] : productionLogs,
      rows: [], // defensive property to protect initial regular mount
    },
  }
}

describe('Milestone 5 Adversarial Stress Challenge: Formatter Functions', () => {
  describe('formatDimension', () => {
    it('handles null, undefined, and non-numeric inputs by returning null', () => {
      expect(formatDimension(null)).toBeNull()
      expect(formatDimension(undefined)).toBeNull()
      expect(formatDimension(Number.NaN)).toBeNull()
      expect(formatDimension(Number.POSITIVE_INFINITY)).toBeNull()
      expect(formatDimension(Number.NEGATIVE_INFINITY)).toBeNull()
      expect(formatDimension('abc')).toBeNull()
      expect(formatDimension({})).toBeNull()
    })

    it('formats 0 and negative dimensions accurately', () => {
      expect(formatDimension(0)).toBe('0.00')
      expect(formatDimension(-0)).toBe('0.00')
      expect(formatDimension(-12.5)).toBe('-12.50')
      expect(formatDimension(-0.001)).toBe('-0.00')
    })

    it('formats standard, small, and very large floats to 2 decimal places', () => {
      expect(formatDimension(625.4)).toBe('625.40')
      expect(formatDimension(1020)).toBe('1020.00')
      expect(formatDimension(12.7)).toBe('12.70')
      expect(formatDimension(6000)).toBe('6000.00')
      expect(formatDimension(0.004)).toBe('0.00')
      expect(formatDimension(0.005)).toBe('0.01')
      expect(formatDimension(999999999.999)).toBe('1000000000.00')
      expect(formatDimension('1120.75')).toBe('1120.75')
    })
  })

  describe('formatTonnage', () => {
    it('handles null, undefined, and non-numeric inputs by returning null', () => {
      expect(formatTonnage(null)).toBeNull()
      expect(formatTonnage(undefined)).toBeNull()
      expect(formatTonnage(Number.NaN)).toBeNull()
      expect(formatTonnage(Number.POSITIVE_INFINITY)).toBeNull()
      expect(formatTonnage(Number.NEGATIVE_INFINITY)).toBeNull()
      expect(formatTonnage('not-a-number')).toBeNull()
    })

    it('formats 0 and fractional decimals accurately to 4 decimals', () => {
      expect(formatTonnage(0)).toBe('0.0000')
      expect(formatTonnage(1.15134)).toBe('1.1513')
      expect(formatTonnage(1.15136)).toBe('1.1514')
      expect(formatTonnage(9.2104)).toBe('9.2104')
      expect(formatTonnage(0.00004)).toBe('0.0000')
      expect(formatTonnage(0.00005)).toBe('0.0001')
      expect(formatTonnage(-0.5)).toBe('-0.5000')
      expect(formatTonnage('3.14159')).toBe('3.1416')
    })
  })

  describe('formatPercentage', () => {
    it('handles null, undefined, and non-numeric inputs by returning null', () => {
      expect(formatPercentage(null)).toBeNull()
      expect(formatPercentage(undefined)).toBeNull()
      expect(formatPercentage(Number.NaN)).toBeNull()
      expect(formatPercentage(Number.POSITIVE_INFINITY)).toBeNull()
    })

    it('formats percentages accurately to 1 decimal with percent suffix', () => {
      expect(formatPercentage(0)).toBe('0.0%')
      expect(formatPercentage(80)).toBe('80.0%')
      expect(formatPercentage(33.333)).toBe('33.3%')
      expect(formatPercentage(99.96)).toBe('100.0%')
    })
  })
})

describe('Milestone 5 Adversarial Stress Challenge: Empty & Loading States', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies exact colspans (7 for breakdown, 8 for cut logs) in empty complete period', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(createBaseReportPayload({
      periodState: 'complete',
      totalOutput: 0,
      specifiedPipes: 0,
      unspecifiedPipes: 0,
      totalTonnage: 0,
      specBreakdown: [],
      productionLogs: [],
    }))

    renderWithAuth(<ReportsSection />)
    await openFilterAndSelectProduction(user)
    await screen.findByText('Output by product specification')

    const tables = document.querySelectorAll('table.reports-table')
    expect(tables.length).toBe(2)

    // Specification Breakdown table: 7 columns
    const specTable = tables[0]
    const specHeaders = specTable.querySelectorAll('thead th')
    expect(specHeaders.length).toBe(7)

    const specEmptyTd = specTable.querySelector('tbody td')
    expect(specEmptyTd).not.toBeNull()
    expect(specEmptyTd.getAttribute('colspan')).toBe('7')
    expect(specEmptyTd.textContent).toBe('No accepted pipe cutting events recorded for this period.')

    // Production Cut Log table: 8 columns
    const cutsTable = tables[1]
    const cutHeaders = cutsTable.querySelectorAll('thead th')
    expect(cutHeaders.length).toBe(8)

    const cutsEmptyTd = cutsTable.querySelector('tbody td')
    expect(cutsEmptyTd).not.toBeNull()
    expect(cutsEmptyTd.getAttribute('colspan')).toBe('8')
    expect(cutsEmptyTd.textContent).toBe('No pipe cutting events registered for this period.')
  })

  it('verifies exact colspans (7 for breakdown, 8 for cut logs) in empty future period', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(createBaseReportPayload({
      periodState: 'future',
      specBreakdown: [],
      productionLogs: [],
    }))

    renderWithAuth(<ReportsSection />)
    await openFilterAndSelectProduction(user)
    await screen.findByText('Output by product specification')

    const tables = document.querySelectorAll('table.reports-table')
    const specTable = tables[0]
    const specEmptyTd = specTable.querySelector('tbody td')
    expect(specEmptyTd.getAttribute('colspan')).toBe('7')
    expect(specEmptyTd.textContent).toBe('Output not observed yet.')

    const cutsTable = tables[1]
    const cutsEmptyTd = cutsTable.querySelector('tbody td')
    expect(cutsEmptyTd.getAttribute('colspan')).toBe('8')
    expect(cutsEmptyTd.textContent).toBe('Pipe cuts not observed yet.')
  })

  it('renders gracefully when specBreakdown and productionLogs are undefined', async () => {
    const user = userEvent.setup()
    const payload = createBaseReportPayload()
    delete payload.report.specBreakdown
    delete payload.report.productionLogs
    getReportSummary.mockResolvedValue(payload)

    renderWithAuth(<ReportsSection />)
    await openFilterAndSelectProduction(user)
    await screen.findByText('Output by product specification')

    const tables = document.querySelectorAll('table.reports-table')
    const specTable = tables[0]
    const cutsTable = tables[1]

    expect(specTable.querySelector('tbody td').getAttribute('colspan')).toBe('7')
    expect(cutsTable.querySelector('tbody td').getAttribute('colspan')).toBe('8')
  })
})

describe('Milestone 5 Adversarial Stress Challenge: Boundary & Extreme Data Table Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const extremeAdversarialPayload = createBaseReportPayload({
    totalOutput: 8,
    specifiedPipes: 4,
    unspecifiedPipes: 4,
    totalTonnage: 127.6821,
    specBreakdown: [
      {
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        totalTonnage: 9.2104,
        isSpecified: true,
        pipeCount: 8,
        percentageOfTotal: 80.0,
      },
      {
        customer: 'Regan Industrial Heavy Works Corp',
        diameter: 2540.0,
        thickness: 50.8,
        length: 18000,
        totalTonnage: 116.2217,
        isSpecified: true,
        pipeCount: 2,
        percentageOfTotal: 20.0,
      },
      {
        // Unspecified batch
        customer: null,
        diameter: null,
        thickness: null,
        length: null,
        totalTonnage: null,
        isSpecified: false,
        pipeCount: 3,
        percentageOfTotal: 30.0,
      },
      {
        // Fallback to label
        customer: '',
        label: 'Legacy Heat Tag #44',
        diameter: 1020,
        thickness: 10.0,
        length: 9000,
        totalTonnage: 2.25,
        isSpecified: true,
        pipeCount: 1,
        percentageOfTotal: 10.0,
      },
      {
        // Zero dimensions
        customer: 'Zero Engineering',
        diameter: 0,
        thickness: 0,
        length: 0,
        totalTonnage: 0,
        isSpecified: true,
        pipeCount: 0,
        percentageOfTotal: 0,
      },
      {
        // Non-finite values
        customer: 'Infinity Pipe Works',
        diameter: Number.POSITIVE_INFINITY,
        thickness: Number.NaN,
        length: Number.NEGATIVE_INFINITY,
        totalTonnage: Number.NaN,
        isSpecified: true,
        pipeCount: 1,
        percentageOfTotal: 10,
      },
    ],
    productionLogs: [
      {
        id: 'log-1',
        deviceEventId: 1,
        recordedAt: '2026-10-31T01:00:00.000Z',
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 1001,
        tonnage: 1.1513,
        isSpecified: true,
      },
      {
        id: 'log-2',
        deviceEventId: 2,
        recordedAt: '2026-10-31T01:05:00.000Z',
        customer: 'Regan Industrial Heavy Works Corp',
        diameter: 2540.0,
        thickness: 50.8,
        length: 18000,
        pipe_number: 999999,
        singleTonnage: 58.1109,
        isSpecified: true,
      },
      {
        id: 'log-3',
        deviceEventId: 3,
        recordedAt: '2026-10-31T01:10:00.000Z',
        customer: null,
        label: null,
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
        tonnage: null,
        isSpecified: false,
      },
      {
        id: 'log-4',
        deviceEventId: 4,
        recordedAt: '2026-10-31T01:15:00.000Z',
        customer: '   ',
        label: 'Batch Tag #88',
        diameter: 1020,
        thickness: 10.0,
        length: 9000,
        pipeNumber: 50,
        tonnage: 2.25,
        isSpecified: true,
      },
      {
        // Zero pipeNumber and zero tonnage
        id: 'log-5',
        deviceEventId: 5,
        recordedAt: '2026-10-31T01:20:00.000Z',
        customer: 'Zero Engineering',
        diameter: 0,
        thickness: 0,
        length: 0,
        pipeNumber: 0,
        tonnage: 0,
        isSpecified: true,
      },
      {
        // Non-finite dimensions and invalid timestamp
        id: 'log-6',
        deviceEventId: 6,
        recordedAt: 'not-a-valid-date',
        customer: 'Infinity Works',
        diameter: Number.POSITIVE_INFINITY,
        thickness: Number.NaN,
        length: Number.NEGATIVE_INFINITY,
        pipeNumber: null,
        tonnage: Number.NaN,
        isSpecified: false,
      },
      {
        // Null timestamp
        id: 'log-7',
        deviceEventId: 7,
        recordedAt: null,
        customer: null,
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
        tonnage: null,
        isSpecified: false,
      },
    ],
  })

  it('renders all boundary rows cleanly without throwing errors', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(extremeAdversarialPayload)

    renderWithAuth(<ReportsSection />)
    await openFilterAndSelectProduction(user)
    await screen.findByText('Output by product specification')

    // 1. Verify Specification Breakdown & Cut Log customer fallbacks
    expect(screen.getAllByText('MCWD').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Regan Industrial Heavy Works Corp').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Unspecified / Pending Tag')).toBeInTheDocument()
    expect(screen.getByText('Legacy Heat Tag #44')).toBeInTheDocument()

    // 2. Verify Cut Log customer fallbacks
    expect(screen.getByText('Batch Tag #88')).toBeInTheDocument()

    // 3. Verify zero value formatting in tables: '0.00' and '0.0000'
    const zeroDimCells = screen.getAllByText('0.00')
    expect(zeroDimCells.length).toBeGreaterThanOrEqual(3)

    const zeroTonsCells = screen.getAllByText('0.0000')
    expect(zeroTonsCells.length).toBeGreaterThanOrEqual(1)

    // 4. Verify pipe serial 0 renders as '0' rather than empty placeholder
    const pipeZero = screen.getByText('0', { selector: 'td' })
    expect(pipeZero).toBeInTheDocument()

    // 5. Verify invalid/null timestamps render 'N/A'
    const naCells = screen.getAllByText('N/A')
    expect(naCells.length).toBeGreaterThanOrEqual(2)

    // 6. Verify non-finite values (Infinity, NaN) fallback to clean dash '—'
    const placeholders = document.querySelectorAll('.production-placeholder')
    expect(placeholders.length).toBeGreaterThanOrEqual(10)
    placeholders.forEach((el) => {
      expect(el.textContent).toBe('—')
    })
  })

  it('enforces right alignment and tabular-data on all numeric columns across both tables', async () => {
    const user = userEvent.setup()
    getReportSummary.mockResolvedValue(extremeAdversarialPayload)

    renderWithAuth(<ReportsSection />)
    await openFilterAndSelectProduction(user)
    await screen.findByText('Output by product specification')

    const tables = document.querySelectorAll('table.reports-table')
    const specTable = tables[0]
    const cutsTable = tables[1]

    // Verify Spec Table headers:
    // Columns: [Customer (left), Diameter (right), Thickness (right), Length (right), Total Tons (right), Quantity (right), % of Total (right)]
    const specHeaders = specTable.querySelectorAll('thead th')
    expect(specHeaders.length).toBe(7)
    expect(specHeaders[0].style.textAlign).not.toBe('right') // Customer is left
    for (let col = 1; col <= 6; col++) {
      expect(specHeaders[col]).toHaveClass('production-col-num', 'tabular-data')
      expect(specHeaders[col].style.textAlign).toBe('right')
    }

    // Verify Cut Log Table headers:
    // Columns: [Cut Time (left), Customer (left), Diameter (right), Thickness (right), Length (right), Pipe # (right), Tons (right), Status (left)]
    const cutHeaders = cutsTable.querySelectorAll('thead th')
    expect(cutHeaders.length).toBe(8)
    expect(cutHeaders[0].style.textAlign).not.toBe('right') // Cut Time
    expect(cutHeaders[1].style.textAlign).not.toBe('right') // Customer
    for (let col = 2; col <= 6; col++) {
      expect(cutHeaders[col]).toHaveClass('production-col-num', 'tabular-data')
      expect(cutHeaders[col].style.textAlign).toBe('right')
    }
    expect(cutHeaders[7].style.textAlign).not.toBe('right') // Status

    // Verify first data row of Cut Log:
    const firstCutRow = cutsTable.querySelector('tbody tr')
    const cutTds = firstCutRow.querySelectorAll('td')
    expect(cutTds[0]).toHaveClass('production-col-timestamp', 'tabular-data')
    expect(cutTds[1].style.textAlign).not.toBe('right') // Customer
    expect(cutTds[2]).toHaveClass('production-col-num', 'tabular-data') // Diameter
    expect(cutTds[2].style.textAlign).toBe('right')
    expect(cutTds[3]).toHaveClass('production-col-num', 'tabular-data') // Thickness
    expect(cutTds[3].style.textAlign).toBe('right')
    expect(cutTds[4]).toHaveClass('production-col-num', 'tabular-data') // Length
    expect(cutTds[4].style.textAlign).toBe('right')
    expect(cutTds[5]).toHaveClass('production-col-num', 'tabular-data') // Pipe #
    expect(cutTds[5].style.textAlign).toBe('right')
    expect(cutTds[6]).toHaveClass('production-col-num', 'tabular-data') // Tons
    expect(cutTds[6].style.textAlign).toBe('right')
  })
})
