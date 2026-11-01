import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { apiRequest } from '../../../shared/services/apiClient.js'
import {
  batchUpdateProductionSpecs,
  getProductionLogs,
  updateProductionLogSpec,
} from './productionService.js'
import { dashboardPageMeta, navItems } from '../../../shared/constants/dashboardMeta.js'
import '../../../shared/components/ui/Calendar.jsx'
import ProductionSection, {
  formatManilaDateTime,
  getManilaDateInputValue,
  hasInformation,
} from './ProductionSection.jsx'

vi.mock('../../../shared/services/apiClient.js', () => ({
  apiRequest: vi.fn(),
}))

const mockProductionPayload = {
  sensor: {
    code: 'S-05',
    label: 'Production Output Cutting',
  },
  machine: {
    code: 'M-01',
    name: 'Spiral Mill 01',
  },
  periodState: 'complete',
  range: {
    start: '2026-10-30T00:00:00+08:00',
    end: '2026-10-31T00:00:00+08:00',
  },
  summary: {
    totalAccepted: 42,
    specifiedCount: 30,
    unspecifiedCount: 12,
    rejectedCount: 2,
  },
  records: [
    {
      id: 'e0000000-0000-4000-8000-000000000001',
      sensorEventId: 'e0000000-0000-4000-8000-000000000001',
      deviceEventId: 101,
      sensorCode: 'S-05',
      sensorLabel: 'Production Output Cutting',
      machineCode: 'M-01',
      machineName: 'Spiral Mill 01',
      recordedAt: '2026-10-30T06:30:00.000Z',
      outputAccepted: true,
      rejectionReason: null,
      status: 'accepted',
      isEditable: true,
      isSpecified: true,
      specStatus: 'specified',
      customer: 'Maynilad Water',
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeNumber: 1001,
      tonnage: 1.1513,
      label: 'Batch Alpha Pipe',
      size: '6 inch',
      updatedAt: '2026-10-30T06:30:00.000Z',
    },
    {
      id: 'e0000000-0000-4000-8000-000000000002',
      sensorEventId: 'e0000000-0000-4000-8000-000000000002',
      deviceEventId: 102,
      sensorCode: 'S-05',
      sensorLabel: 'Production Output Cutting',
      machineCode: 'M-01',
      machineName: 'Spiral Mill 01',
      recordedAt: '2026-10-30T07:15:00.000Z',
      outputAccepted: true,
      rejectionReason: null,
      status: 'accepted',
      isEditable: true,
      isSpecified: false,
      specStatus: 'unspecified',
      customer: null,
      diameter: null,
      thickness: null,
      length: null,
      pipeNumber: null,
      tonnage: null,
      label: null,
      size: null,
      updatedAt: null,
    },
    {
      id: 'e0000000-0000-4000-8000-000000000003',
      sensorEventId: 'e0000000-0000-4000-8000-000000000003',
      deviceEventId: 103,
      sensorCode: 'S-05',
      sensorLabel: 'Production Output Cutting',
      machineCode: 'M-01',
      machineName: 'Spiral Mill 01',
      recordedAt: '2026-10-30T08:00:00.000Z',
      outputAccepted: false,
      rejectionReason: 'Debounce window violated.',
      status: 'rejected',
      isEditable: false,
      isSpecified: false,
      specStatus: 'rejected',
      customer: null,
      diameter: null,
      thickness: null,
      length: null,
      pipeNumber: null,
      tonnage: null,
      label: null,
      size: null,
      updatedAt: null,
    },
  ],
  pagination: {
    page: 1,
    pageSize: 25,
    total: 42,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
  },
}

describe('productionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls apiRequest with default path and token when no filters provided', async () => {
    apiRequest.mockResolvedValueOnce({ records: [] })

    await getProductionLogs('mock-token')

    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith('/api/production', {
      token: 'mock-token',
      signal: undefined,
    })
  })

  it('correctly serializes pagination and filter query parameters', async () => {
    apiRequest.mockResolvedValueOnce({ records: [] })

    await getProductionLogs('mock-token', {
      page: 2,
      pageSize: 50,
      date: '2026-10-30',
      status: 'accepted',
      specStatus: 'specified',
      search: 'Alpha Pipe',
    })

    expect(apiRequest).toHaveBeenCalledTimes(1)
    const calledUrl = apiRequest.mock.calls[0][0]
    expect(calledUrl).toContain('/api/production?')
    expect(calledUrl).toContain('page=2')
    expect(calledUrl).toContain('pageSize=50')
    expect(calledUrl).toContain('date=2026-10-30')
    expect(calledUrl).toContain('status=accepted')
    expect(calledUrl).toContain('specStatus=specified')
    expect(calledUrl).toContain('search=Alpha+Pipe')
  })

  it('handles limit alias when pageSize is omitted', async () => {
    apiRequest.mockResolvedValueOnce({ records: [] })

    await getProductionLogs('mock-token', {
      limit: 10,
    })

    expect(apiRequest).toHaveBeenCalledWith('/api/production?limit=10', {
      token: 'mock-token',
      signal: undefined,
    })
  })

  it('serializes dateFrom and dateTo range parameters', async () => {
    apiRequest.mockResolvedValueOnce({ records: [] })

    await getProductionLogs('mock-token', {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-15',
    })

    const calledUrl = apiRequest.mock.calls[0][0]
    expect(calledUrl).toContain('dateFrom=2026-10-01')
    expect(calledUrl).toContain('dateTo=2026-10-15')
  })

  it('trims whitespace and ignores empty search queries', async () => {
    apiRequest.mockResolvedValueOnce({ records: [] })

    await getProductionLogs('mock-token', {
      search: '   ',
    })

    expect(apiRequest).toHaveBeenCalledWith('/api/production', {
      token: 'mock-token',
      signal: undefined,
    })
  })

  it('normalizes records including customer, diameter, thickness, length, pipeNumber, and tonnage', async () => {
    apiRequest.mockResolvedValueOnce({
      records: [
        {
          id: 'e1',
          customer: '  Petro Hydro  ',
          diameter: '625.4',
          thickness: '12.7',
          length: '6000',
          pipe_number: '101',
          tonnage: '1.1513',
        },
      ],
    })

    const payload = await getProductionLogs('mock-token')
    expect(payload.records[0]).toMatchObject({
      customer: 'Petro Hydro',
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeNumber: 101,
      tonnage: 1.1513,
    })
  })

  it('propagates API client errors', async () => {
    apiRequest.mockRejectedValueOnce(new Error('Network failure'))

    await expect(getProductionLogs('mock-token')).rejects.toThrow('Network failure')
  })
})

describe('productionService updateProductionLogSpec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls apiRequest with PATCH, flat body with pipe specs, and expectedUpdatedAt', async () => {
    apiRequest.mockResolvedValueOnce({ spec: { customer: 'Maynilad Water' } })

    const spec = {
      customer: 'Maynilad Water',
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeNumber: 1001,
    }
    const expectedUpdatedAt = '2026-10-30T06:30:00.000Z'

    await updateProductionLogSpec('mock-token', 'e0000000-0000-4000-8000-000000000001', spec, expectedUpdatedAt)

    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith('/api/production/e0000000-0000-4000-8000-000000000001', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        customer: 'Maynilad Water',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 1001,
        expectedUpdatedAt: '2026-10-30T06:30:00.000Z',
      },
    })
  })

  it('handles null and undefined specification fields and optional expectedUpdatedAt', async () => {
    apiRequest.mockResolvedValueOnce({ spec: { customer: null } })

    await updateProductionLogSpec('mock-token', 'e0000000-0000-4000-8000-000000000001', {})

    expect(apiRequest).toHaveBeenCalledWith('/api/production/e0000000-0000-4000-8000-000000000001', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        customer: null,
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
      },
    })
  })

  it('converts empty strings to null and numeric strings to numbers', async () => {
    apiRequest.mockResolvedValueOnce({ spec: { customer: null } })

    await updateProductionLogSpec(
      'mock-token',
      'e0000000-0000-4000-8000-000000000001',
      {
        customer: '   ',
        diameter: '625.4',
        thickness: '',
        length: '6000',
        pipeNumber: '1001',
      },
      null,
    )

    expect(apiRequest).toHaveBeenCalledWith('/api/production/e0000000-0000-4000-8000-000000000001', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        customer: null,
        diameter: 625.4,
        thickness: null,
        length: 6000,
        pipeNumber: 1001,
        expectedUpdatedAt: null,
      },
    })
  })

  it('strictly excludes legacy radius and circumference from outbound body', async () => {
    apiRequest.mockResolvedValueOnce({ spec: { customer: 'Client X' } })

    await updateProductionLogSpec(
      'mock-token',
      'e0000000-0000-4000-8000-000000000001',
      {
        customer: 'Client X',
        diameter: 500,
        thickness: 10,
        length: 6000,
        pipeNumber: 55,
        radius: 250,
        circumference: 1570.8,
      },
    )

    const callArgs = apiRequest.mock.calls[0]
    expect(callArgs[1].body.radius).toBeUndefined()
    expect(callArgs[1].body.circumference).toBeUndefined()
  })

  it('propagates HTTP 409 conflict ApiError from apiRequest', async () => {
    const conflictError = new Error('Production specification was modified by another user.')
    conflictError.status = 409
    conflictError.code = 'PRODUCTION_SPEC_CONFLICT'
    apiRequest.mockRejectedValueOnce(conflictError)

    await expect(
      updateProductionLogSpec(
        'mock-token',
        'e0000000-0000-4000-8000-000000000001',
        { customer: 'Maynilad' },
        '2026-10-30T06:30:00.000Z',
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'PRODUCTION_SPEC_CONFLICT',
    })
  })

  it('propagates generic network error', async () => {
    apiRequest.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      updateProductionLogSpec('mock-token', 'e0000000-0000-4000-8000-000000000001', { customer: 'Maynilad' }),
    ).rejects.toThrow('Network error')
  })
})

describe('productionService batchUpdateProductionSpecs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls apiRequest with PATCH /api/production/batch, sensorEventIds, and sanitized appliedSpec', async () => {
    apiRequest.mockResolvedValueOnce({ updatedCount: 2, matchedCount: 2 })

    await batchUpdateProductionSpecs('mock-token', {
      sensorEventIds: ['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002'],
      appliedSpec: {
        customer: '  Maynilad Water  ',
        diameter: '625.4',
        thickness: '12.7',
        length: '6000',
      },
    })

    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith('/api/production/batch', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002'],
        customer: 'Maynilad Water',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
      },
    })
  })

  it('omits blank fields in bulk update preserving existing values', async () => {
    apiRequest.mockResolvedValueOnce({ updatedCount: 1 })

    await batchUpdateProductionSpecs('mock-token', {
      sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
      appliedSpec: {
        customer: 'New Customer Only',
        diameter: '',
        thickness: undefined,
        length: null,
      },
    })

    expect(apiRequest).toHaveBeenCalledWith('/api/production/batch', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        customer: 'New Customer Only',
      },
    })
  })

  it('serializes date and date range filters when sensorEventIds are not provided', async () => {
    apiRequest.mockResolvedValueOnce({ updatedCount: 5 })

    await batchUpdateProductionSpecs('mock-token', {
      date: '2026-10-30',
      onlyUnlabeled: true,
      appliedSpec: { customer: 'Range Customer' },
    })

    expect(apiRequest).toHaveBeenCalledWith('/api/production/batch', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        dateFrom: '2026-10-30',
        dateTo: '2026-10-30',
        onlyUnlabeled: true,
        customer: 'Range Customer',
      },
    })
  })

  it('strictly excludes radius, circumference, and pipeNumber from batchUpdate body', async () => {
    apiRequest.mockResolvedValueOnce({ updatedCount: 1 })

    await batchUpdateProductionSpecs('mock-token', {
      sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
      appliedSpec: {
        customer: 'Valid Customer',
        diameter: 500,
        thickness: 10,
        length: 6000,
        pipeNumber: 101,
        radius: 250,
        circumference: 1570,
      },
    })

    const callBody = apiRequest.mock.calls[0][1].body
    expect(callBody.radius).toBeUndefined()
    expect(callBody.circumference).toBeUndefined()
    expect(callBody.pipeNumber).toBeUndefined()
  })

  it('propagates API errors from batchUpdateProductionSpecs', async () => {
    apiRequest.mockRejectedValueOnce(new Error('Batch update failed'))

    await expect(
      batchUpdateProductionSpecs('mock-token', {
        sensorEventIds: ['e1'],
        appliedSpec: { customer: 'Pipe' },
      }),
    ).rejects.toThrow('Batch update failed')
  })
})

describe('ProductionSection utilities', () => {
  it('formats Manila date input value as YYYY-MM-DD', () => {
    const val = getManilaDateInputValue()
    expect(val).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('formats ISO timestamps to Asia/Manila date-time string', () => {
    const formatted = formatManilaDateTime('2026-10-30T06:30:00.000Z')
    expect(formatted).toBe('2026-10-30 14:30:00')
  })

  it('handles null, undefined, and invalid timestamps safely', () => {
    expect(formatManilaDateTime(null)).toBe('—')
    expect(formatManilaDateTime(undefined)).toBe('—')
    expect(formatManilaDateTime('invalid-date')).toBe('—')
  })
})

describe('ProductionSection component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders header, sensor label from sensorIdentity, and KPI metrics', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    // Heading and station prefix eyebrow
    expect(await screen.findByRole('heading', { level: 1, name: 'Production Logs' })).toBeInTheDocument()
    expect(screen.getByText(/S-05 · PRODUCTION OUTPUT CUTTING · SPIRAL MILL 01/i)).toBeInTheDocument()
    expect(screen.queryByText(/cuts and product specifications/i)).not.toBeInTheDocument()

    // KPI Metrics scoped to summary region
    const kpiRegion = screen.getByRole('region', { name: 'Production Summary Metrics' })
    expect(within(kpiRegion).getByText('42')).toBeInTheDocument()
    expect(within(kpiRegion).getByText('Accepted')).toBeInTheDocument()
    expect(within(kpiRegion).getByText('30')).toBeInTheDocument()
    expect(within(kpiRegion).getByText('Specified')).toBeInTheDocument()
    expect(within(kpiRegion).getByText('12')).toBeInTheDocument()
    expect(within(kpiRegion).getByText('Unspecified')).toBeInTheDocument()
  })

  it('renders table rows with formatted timestamps, labels, dimensions, and status icons', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    // Wait for row 1
    expect(await screen.findByText('Maynilad Water')).toBeInTheDocument()
    expect(screen.getByText('625.40')).toBeInTheDocument()
    expect(screen.getByText('12.70')).toBeInTheDocument()
    expect(screen.getByText('6000.00')).toBeInTheDocument()
    expect(screen.getByText('1001')).toBeInTheDocument()
    expect(screen.getByText('1.1513')).toBeInTheDocument()
    expect(screen.getByText('2026-10-30 14:30:00')).toBeInTheDocument()

    // Status icon assertions
    const specifiedIcon = screen.getByTitle('Accepted · Specified')
    expect(specifiedIcon).toBeInTheDocument()

    const unspecifiedIcon = screen.getByTitle('Accepted · Needs details')
    expect(unspecifiedIcon).toBeInTheDocument()

    const rejectedIcon = screen.getByTitle('Debounce window violated.')
    expect(rejectedIcon).toBeInTheDocument()

    // Row 2 placeholders
    const placeholders = screen.getAllByText('—')
    expect(placeholders.length).toBeGreaterThanOrEqual(5)
  })

  it('renders 10-column table structure and strictly excludes radius and circumference headers', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    expect(await screen.findByText('Maynilad Water')).toBeInTheDocument()

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent.trim())
    expect(headers).toEqual([
      '',
      'Status',
      'Cut Time',
      'Customer',
      'Diameter (OD mm)',
      'Thickness (mm)',
      'Length (mm)',
      'Pipe #',
      'Tons',
      'Action',
    ])
    expect(screen.queryByRole('columnheader', { name: /radius/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /circumference/i })).not.toBeInTheDocument()
  })

  it('handles date filter changes via calendar popover and queries with updated date', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')

    const dateTrigger = screen.getByLabelText('Filter by date')
    expect(dateTrigger).toHaveClass('trend-calendar-trigger')
    await user.click(dateTrigger)

    const calendarDialog = await screen.findByRole('dialog', { name: 'Select production date' })
    const dayButtons = await within(calendarDialog).findAllByRole('button')
    const activeDay = dayButtons.find((btn) => !btn.disabled && /^\d+$/.test(btn.textContent.trim()))
    expect(activeDay).toBeDefined()
    await user.click(activeDay)

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        page: 1,
      }))
    })
  })

  it('clears date filter and queries with undefined date', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')

    const clearBtn = screen.getByRole('button', { name: 'Clear date filter' })
    await user.click(clearBtn)

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        date: undefined,
        page: 1,
      }))
    })
    expect(screen.queryByRole('button', { name: 'Clear date filter' })).not.toBeInTheDocument()
  })

  it('handles cut status filter changes', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')

    const statusSelect = screen.getByLabelText('Filter by cut status')
    await user.click(statusSelect)
    await user.click(screen.getByRole('option', { name: 'Rejected' }))

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        status: 'rejected',
        page: 1,
      }))
    })
  })

  it('handles specification status filter changes', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')

    const specSelect = screen.getByLabelText('Filter by specification status')
    await user.click(specSelect)
    await user.click(screen.getByRole('option', { name: 'Unspecified' }))

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        specStatus: 'unspecified',
        page: 1,
      }))
    })
  })

  it('handles search input with Enter key submission', async () => {
    const user = userEvent.setup({ delay: null })
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')

    const searchInput = screen.getByLabelText('Search production cuts')
    await user.type(searchInput, 'Maynilad{Enter}')

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        search: 'Maynilad',
        page: 1,
      }))
    })
  }, 15000)

  it('handles pagination navigation next and previous', async () => {
    const user = userEvent.setup({ delay: null })
    const mockLoad = vi.fn()
      .mockResolvedValueOnce(mockProductionPayload)
      .mockResolvedValueOnce({
        ...mockProductionPayload,
        records: [
          {
            id: 'e0000000-0000-4000-8000-000000000004',
            sensorEventId: 'e0000000-0000-4000-8000-000000000004',
            recordedAt: '2026-10-30T09:00:00.000Z',
            outputAccepted: true,
            isSpecified: true,
            customer: 'Page Two Pipe Customer',
            diameter: 203.2,
            thickness: 6.4,
            length: 6000,
            pipeNumber: 2001,
            tonnage: 0.1865,
          },
        ],
        pagination: {
          page: 2,
          pageSize: 25,
          total: 42,
          totalPages: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      })

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    expect(await screen.findByText('Page 1 of 2 · 42 records')).toBeInTheDocument()

    const prevButton = screen.getByRole('button', { name: 'Previous page' })
    const nextButton = screen.getByRole('button', { name: 'Next page' })

    expect(prevButton).toBeDisabled()
    expect(nextButton).not.toBeDisabled()

    await user.click(nextButton)

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        page: 2,
      }))
    })

    expect(await screen.findByText('Page Two Pipe Customer', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2 · 42 records')).toBeInTheDocument()
  })

  it('renders loading skeleton during initial fetch', () => {
    const mockLoad = vi.fn().mockReturnValue(new Promise(() => { }))

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    const skeleton = screen.getByRole('status', { name: 'Loading production records' })
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveClass('skeleton')
  })

  it('renders empty state when zero records match filters', async () => {
    const mockLoad = vi.fn().mockResolvedValue({
      sensor: { code: 'S-05', label: 'Production Output Cutting' },
      machine: { code: 'M-01', name: 'Spiral Mill 01' },
      summary: { totalAccepted: 0, specifiedCount: 0, unspecifiedCount: 0, rejectedCount: 0 },
      records: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    expect(await screen.findByText('No production records found for the selected filters.')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1 · 0 records')).toBeInTheDocument()
  })

  it('renders error notice with retry button and recovers when retry clicked', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn()
      .mockRejectedValueOnce(new Error('Database connectivity issue'))
      .mockResolvedValueOnce(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Database connectivity issue')

    const retryBtn = within(alert).getByRole('button', { name: 'Retry' })
    await user.click(retryBtn)

    expect(await screen.findByText('Maynilad Water')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('strictly adheres to production permissions and guardrails', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    // Admin has edit buttons and selection checkboxes for accepted cuts
    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')

    const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
    expect(editButtons.length).toBe(2)

    // Checkboxes are rendered for accepted cuts plus header select-all
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBe(4) // 1 header + 2 accepted cuts + 1 disabled rejected cut

    // Bulk edit strip not shown until cuts are selected
    expect(screen.queryByRole('region', { name: 'Bulk specification editor' })).not.toBeInTheDocument()

    // No export button
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })

  describe('role-based authorization', () => {
    const allowedRoles = ['Admin', 'Operation Manager', 'Production Supervisor', 'Quality Control']
    const readOnlyRoles = ['Engineering Supervisor', 'Operator']

    allowedRoles.forEach((role) => {
      it(`renders edit controls and Action column for authorized role: ${role}`, async () => {
        const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

        renderWithAuth(<ProductionSection loadProduction={mockLoad} />, {
          authValue: { user: { role } },
        })

        expect(await screen.findByText('Maynilad Water')).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument()
        const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
        expect(editButtons.length).toBe(2)
        expect(screen.getAllByRole('checkbox').length).toBe(4)
      })
    })

    readOnlyRoles.forEach((role) => {
      it(`strictly hides edit controls and Action column for view-only role: ${role}`, async () => {
        const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

        renderWithAuth(<ProductionSection loadProduction={mockLoad} />, {
          authValue: { user: { role } },
        })

        expect(await screen.findByText('Maynilad Water')).toBeInTheDocument()
        expect(screen.queryByRole('columnheader', { name: 'Action' })).not.toBeInTheDocument()
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
      })
    })
  })

  it('enforces view-only constraint for rejected cuts even for Admin role', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')
    const rows = screen.getAllByRole('row')
    const rejectedRow = rows[3]

    expect(within(rejectedRow).getByTitle('Debounce window violated.')).toBeInTheDocument()
    expect(within(rejectedRow).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(within(rejectedRow).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders inline inputs with current values when edit button is clicked', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')
    const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
    await user.click(editButtons[0])

    const customerInput = screen.getByLabelText('Specification customer')
    expect(customerInput).toHaveValue('Maynilad Water')

    const diameterInput = screen.getByLabelText('Specification diameter')
    expect(diameterInput).toHaveValue(625.4)

    const thicknessInput = screen.getByLabelText('Specification thickness')
    expect(thicknessInput).toHaveValue(12.7)

    const lengthInput = screen.getByLabelText('Specification length')
    expect(lengthInput).toHaveValue(6000)

    const pipeNumberInput = screen.getByLabelText('Specification pipe number')
    expect(pipeNumberInput).toHaveValue(1001)

    expect(screen.queryByLabelText('Specification tons')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Specification radius')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Specification circumference')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Save specification' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeInTheDocument()
  })

  it('supports Tab and Shift+Tab navigation across inline inputs', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Maynilad Water')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const customerInput = screen.getByLabelText('Specification customer')
    const diameterInput = screen.getByLabelText('Specification diameter')
    const thicknessInput = screen.getByLabelText('Specification thickness')
    const lengthInput = screen.getByLabelText('Specification length')
    const pipeNumberInput = screen.getByLabelText('Specification pipe number')

    customerInput.focus()
    expect(customerInput).toHaveFocus()

    await user.tab()
    expect(diameterInput).toHaveFocus()

    await user.tab()
    expect(thicknessInput).toHaveFocus()

    await user.tab()
    expect(lengthInput).toHaveFocus()

    await user.tab()
    expect(pipeNumberInput).toHaveFocus()

    await user.tab({ shift: true })
    expect(lengthInput).toHaveFocus()
  })

  it('saves inline edit on Enter key press', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn().mockResolvedValue({
      spec: {
        sensorEventId: 'e0000000-0000-4000-8000-000000000001',
        customer: 'Manila Water Corp',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 1001,
        tonnage: 1.1513,
        isSpecified: true,
        specStatus: 'specified',
        updatedAt: '2026-10-30T09:00:00.000Z',
      },
    })

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Maynilad Water')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const customerInput = screen.getByLabelText('Specification customer')
    await user.clear(customerInput)
    await user.type(customerInput, 'Manila Water Corp{Enter}')

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'test-token',
        'e0000000-0000-4000-8000-000000000001',
        expect.objectContaining({ customer: 'Manila Water Corp' }),
        '2026-10-30T06:30:00.000Z',
      )
    })

    expect(await screen.findByText('Manila Water Corp')).toBeInTheDocument()
    expect(screen.queryByLabelText('Specification customer')).not.toBeInTheDocument()
  })

  it('cancels inline edit on Escape key press and restores previous values', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn()

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Maynilad Water')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const customerInput = screen.getByLabelText('Specification customer')
    await user.clear(customerInput)
    await user.type(customerInput, 'Unsaved Modified Customer{Escape}')

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Specification customer')).not.toBeInTheDocument()
    expect(screen.getByText('Maynilad Water')).toBeInTheDocument()
  })

  it('cancels inline edit on Cancel button click', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn()

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Maynilad Water')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const customerInput = screen.getByLabelText('Specification customer')
    await user.clear(customerInput)
    await user.type(customerInput, 'Discarded Customer')
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }))

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Specification customer')).not.toBeInTheDocument()
    expect(screen.getByText('Maynilad Water')).toBeInTheDocument()
  })

  it('optimistically updates row values and applies 150ms flash class upon save', async () => {
    const user = userEvent.setup({ delay: null })
    let resolveUpdate
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve
    })
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn().mockReturnValue(updatePromise)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Maynilad Water')
    const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
    await user.click(editButtons[1]) // row 2 was unspecified

    const customerInput = screen.getByLabelText('Specification customer')
    await user.type(customerInput, 'Optimistic Pipe Customer')
    await user.click(screen.getByRole('button', { name: 'Save specification' }))

    // Immediate optimistic update
    expect(screen.getByText('Optimistic Pipe Customer')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    const editedRow = rows[2]
    expect(editedRow).toHaveClass('production-row-flash')

    // Resolve backend update
    resolveUpdate({
      spec: {
        sensorEventId: 'e0000000-0000-4000-8000-000000000002',
        customer: 'Optimistic Pipe Customer',
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
        tonnage: null,
        isSpecified: true,
        specStatus: 'specified',
        updatedAt: '2026-10-30T10:00:00.000Z',
      },
    })

    await waitFor(() => {
      expect(editedRow).not.toHaveClass('production-row-flash')
    })
  })

  it('displays conflict notice and reloads latest data on HTTP 409 Conflict', async () => {
    const user = userEvent.setup()
    const conflictError = new Error('Production specification was modified by another user.')
    conflictError.status = 409
    conflictError.code = 'PRODUCTION_SPEC_CONFLICT'

    const mockLoad = vi.fn()
      .mockResolvedValueOnce(mockProductionPayload)
      .mockResolvedValueOnce({
        ...mockProductionPayload,
        records: [
          {
            ...mockProductionPayload.records[0],
            customer: 'Server Updated Pipe Customer',
            updatedAt: '2026-10-30T08:00:00.000Z',
          },
          ...mockProductionPayload.records.slice(1),
        ],
      })

    const mockUpdate = vi.fn().mockRejectedValueOnce(conflictError)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Maynilad Water')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const customerInput = screen.getByLabelText('Specification customer')
    await user.clear(customerInput)
    await user.type(customerInput, 'Conflicting Change')
    await user.click(screen.getByRole('button', { name: 'Save specification' }))

    // Assert conflict notice alert
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/modified by another user/i)

    // Assert reload was triggered to sync server data
    await waitFor(() => {
      expect(mockLoad).toHaveBeenCalledTimes(2)
    })

    // Assert server value is rendered after reload
    expect(await screen.findByText('Server Updated Pipe Customer')).toBeInTheDocument()
    expect(screen.queryByText('Conflicting Change')).not.toBeInTheDocument()
  })

  it('rolls back optimistic state on generic network error', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn().mockRejectedValueOnce(new Error('Network connection dropped'))

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Maynilad Water')
    const kpiRegion = screen.getByRole('region', { name: 'Production Summary Metrics' })
    expect(within(kpiRegion).getByText('30')).toBeInTheDocument() // specified count

    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[1]) // row 2 (unspecified)
    const customerInput = screen.getByLabelText('Specification customer')
    await user.type(customerInput, 'Temporary Pipe Customer')
    await user.click(screen.getByRole('button', { name: 'Save specification' }))

    // Error alert displayed
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Network connection dropped')

    // Rolled back
    expect(screen.queryByText('Temporary Pipe Customer')).not.toBeInTheDocument()
    expect(within(kpiRegion).getByText('30')).toBeInTheDocument()
  })

  describe('Step 7: Selection, Bulk Edit, and Tools', () => {
    it('handles row selection, header select-all, and Shift+Click range selection', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const headerCheckbox = screen.getByLabelText('Select all cuts on this page')
      const row1Checkbox = screen.getByLabelText(/select cut at 2026-10-30T06:30:00/i)
      const row2Checkbox = screen.getByLabelText(/select cut at 2026-10-30T07:15:00/i)
      const rejectedCheckbox = screen.getByLabelText(/select cut at 2026-10-30T08:00:00/i)

      expect(rejectedCheckbox).toBeDisabled()

      // Click row 1 checkbox
      await user.click(row1Checkbox)
      expect(row1Checkbox).toBeChecked()
      expect(screen.getByText('1 cut selected')).toBeInTheDocument()

      // Header checkbox becomes indeterminate
      expect(headerCheckbox.indeterminate).toBe(true)

      // Shift+Click row 2
      await user.keyboard('{Shift>}')
      await user.click(row2Checkbox)
      await user.keyboard('{/Shift}')

      expect(row2Checkbox).toBeChecked()
      expect(screen.getByText('2 cuts selected')).toBeInTheDocument()
      expect(headerCheckbox).toBeChecked()

      // Deselect all button
      await user.click(screen.getByRole('button', { name: 'Deselect all cuts' }))
      expect(row1Checkbox).not.toBeChecked()
      expect(row2Checkbox).not.toBeChecked()
      expect(screen.queryByText(/cuts selected/i)).not.toBeInTheDocument()

      // Header select-all toggle excludes outputs with information already filled up
      await user.click(headerCheckbox)
      expect(row1Checkbox).not.toBeChecked()
      expect(row2Checkbox).toBeChecked()
      expect(screen.getByText('1 cut selected')).toBeInTheDocument()

      await user.click(headerCheckbox)
      expect(row1Checkbox).not.toBeChecked()
      expect(row2Checkbox).not.toBeChecked()
      expect(screen.queryByText(/cuts selected/i)).not.toBeInTheDocument()
    })

    it('requires confirmation before applying bulk specifications', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
      const mockBatchUpdate = vi.fn().mockResolvedValue({ matchedCount: 2, updatedCount: 2 })

      renderWithAuth(
        <ProductionSection
          loadProduction={mockLoad}
          batchUpdateProductionSpecs={mockBatchUpdate}
        />,
      )

      await screen.findByText('Maynilad Water')

      // Select both cuts explicitly by user choice
      const row1Checkbox = screen.getByLabelText(/select cut at 2026-10-30T06:30:00/i)
      const row2Checkbox = screen.getByLabelText(/select cut at 2026-10-30T07:15:00/i)
      await user.click(row1Checkbox)
      await user.click(row2Checkbox)

      expect(screen.getByText('2 cuts selected')).toBeInTheDocument()

      const customerInput = screen.getByLabelText('Bulk customer')
      expect(customerInput).toHaveAttribute('placeholder', 'Customer / Client')
      expect(screen.getByLabelText('Bulk diameter')).toHaveAttribute('placeholder', 'Diameter (OD)')
      expect(screen.getByLabelText('Bulk thickness')).toHaveAttribute('placeholder', 'Thickness')
      expect(screen.getByLabelText('Bulk length')).toHaveAttribute('placeholder', 'Length')
      await user.type(customerInput, 'Bulk Pipe Standard Customer')

      const applyBtn = screen.getByRole('button', { name: 'Apply to 2 cuts' })
      await user.click(applyBtn)

      // Confirmation prompt appears
      expect(screen.getByText(/apply specifications to 2 cuts/i)).toBeInTheDocument()

      // Cancel confirmation
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByText(/apply specifications to 2 cuts/i)).not.toBeInTheDocument()
      expect(mockBatchUpdate).not.toHaveBeenCalled()

      // Click apply again and confirm
      await user.click(screen.getByRole('button', { name: 'Apply to 2 cuts' }))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await waitFor(() => {
        expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
        expect(mockBatchUpdate).toHaveBeenCalledWith('test-token', {
          sensorEventIds: [
            'e0000000-0000-4000-8000-000000000001',
            'e0000000-0000-4000-8000-000000000002',
          ],
          appliedSpec: {
            customer: 'Bulk Pipe Standard Customer',
          },
        })
      })
    })

    it('populates bulk form using Repeat Last Spec helper', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const row2Checkbox = screen.getByLabelText(/select cut at 2026-10-30T07:15:00/i)
      await user.click(row2Checkbox)

      const repeatBtn = screen.getByRole('button', { name: 'Repeat last saved specification' })
      await user.click(repeatBtn)

      expect(screen.getByLabelText('Bulk customer')).toHaveValue('Maynilad Water')
      expect(screen.getByLabelText('Bulk diameter')).toHaveValue(625.4)
      expect(screen.getByLabelText('Bulk thickness')).toHaveValue(12.7)
      expect(screen.getByLabelText('Bulk length')).toHaveValue(6000)
    })

    it('allows editing individual bulk dimension inputs independently without auto-calculation', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const row1Checkbox = screen.getByLabelText(/select cut at 2026-10-30T06:30:00/i)
      await user.click(row1Checkbox)

      expect(screen.queryByRole('button', { name: 'Geometry Calculator' })).not.toBeInTheDocument()

      const diameterInput = screen.getByLabelText('Bulk diameter')
      const thicknessInput = screen.getByLabelText('Bulk thickness')
      const lengthInput = screen.getByLabelText('Bulk length')

      // Typing diameter updates only diameter
      await user.clear(diameterInput)
      await user.type(diameterInput, '500')

      expect(diameterInput).toHaveValue(500)
      expect(thicknessInput).toHaveValue(null)
      expect(lengthInput).toHaveValue(null)

      // Typing thickness updates only thickness
      await user.clear(thicknessInput)
      await user.type(thicknessInput, '10')

      expect(diameterInput).toHaveValue(500)
      expect(thicknessInput).toHaveValue(10)
      expect(lengthInput).toHaveValue(null)

      // Typing length updates only length
      await user.clear(lengthInput)
      await user.type(lengthInput, '6000')

      expect(diameterInput).toHaveValue(500)
      expect(thicknessInput).toHaveValue(10)
      expect(lengthInput).toHaveValue(6000)

      // Verify absence of radius and circumference inputs
      expect(screen.queryByLabelText('Bulk radius')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Bulk circumference')).not.toBeInTheDocument()

      // Verify all 4 inputs have placeholders
      expect(screen.getByLabelText('Bulk customer')).toHaveAttribute('placeholder', 'Customer / Client')
      expect(diameterInput).toHaveAttribute('placeholder', 'Diameter (OD)')
      expect(thicknessInput).toHaveAttribute('placeholder', 'Thickness')
      expect(lengthInput).toHaveAttribute('placeholder', 'Length')

      // Verify mm unit suffixes are pinned inside wrappers
      const unitBadges = screen.getAllByText('mm')
      expect(unitBadges.length).toBeGreaterThanOrEqual(3)
      unitBadges.forEach((badge) => {
        expect(badge).toHaveClass('unit-suffix')
      })
    })

    it('verifies production log page meta and navigation item have no subtext', () => {
      expect(dashboardPageMeta['/dashboard/production'].subtitle).toBeUndefined()
      const prodNav = navItems.find((item) => item.to === '/dashboard/production')
      expect(prodNav?.subtitle).toBeUndefined()
    })

    it('supports quick Unspecified cuts filter toggle button and KPI metric button', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const toggleBtn = screen.getByRole('button', { name: 'Toggle unspecified cuts filter' })
      await user.click(toggleBtn)

      await waitFor(() => {
        expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
          specStatus: 'unspecified',
        }))
      })

      const kpiBtn = screen.getByRole('button', { name: 'Filter unspecified cuts' })
      await user.click(kpiBtn)

      await waitFor(() => {
        expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
          specStatus: 'all',
        }))
      })
    })

    it('requires at least one field when clicking apply in bulk editor', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const row1Checkbox = screen.getByLabelText(/select cut at 2026-10-30T06:30:00/i)
      await user.click(row1Checkbox)

      const applyBtn = screen.getByRole('button', { name: 'Apply to 1 cut' })
      await user.click(applyBtn)

      expect(await screen.findByRole('alert')).toHaveTextContent(/provide at least one specification field/i)
    })
  })

  describe('UI alignment and design system adherence', () => {
    it('renders clean headers without decorative microchip, clock, or calculator icons', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      // 1. Eyebrow has plain text with no leading icon
      const eyebrow = screen.getByText('S-05 · PRODUCTION OUTPUT CUTTING · SPIRAL MILL 01')
      expect(eyebrow.tagName).toBe('P')
      expect(eyebrow.querySelector('svg')).toBeNull()

      // 2. Cut Time header has no Clock icon
      const timestampHeader = screen.getByRole('columnheader', { name: 'Cut Time' })
      expect(timestampHeader.querySelector('svg')).toBeNull()

      // 3. Bulk header indicator has no checkbox icon
      const row1Checkbox = screen.getByLabelText(/select cut at 2026-10-30T06:30:00/i)
      await user.click(row1Checkbox)

      const bulkCount = screen.getByText('1 cut selected')
      expect(bulkCount.parentElement.querySelector('svg')).toBeNull()

      // 4. Geometry calculator button is not rendered
      expect(screen.queryByRole('button', { name: 'Geometry Calculator' })).not.toBeInTheDocument()
    })

    it('manages custom dropdown open, option selection, escape key, focusout, and outside click', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const statusTrigger = screen.getByRole('button', { name: 'Filter by cut status' })
      expect(screen.queryByRole('listbox', { name: 'Filter by cut status' })).not.toBeInTheDocument()

      // Open status dropdown
      await user.click(statusTrigger)
      expect(screen.getByRole('listbox', { name: 'Filter by cut status' })).toBeInTheDocument()

      // Close via Escape key and ensure focus returns to trigger
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('listbox', { name: 'Filter by cut status' })).not.toBeInTheDocument()
      expect(statusTrigger).toHaveFocus()

      // Open spec status dropdown
      const specTrigger = screen.getByRole('button', { name: 'Filter by specification status' })
      await user.click(specTrigger)
      expect(screen.getByRole('listbox', { name: 'Filter by specification status' })).toBeInTheDocument()

      // Close via outside pointer down
      await user.pointer({ target: document.body, keys: '[MouseLeft]' })
      expect(screen.queryByRole('listbox', { name: 'Filter by specification status' })).not.toBeInTheDocument()

      // Open status dropdown, select option, and verify focus returns to trigger
      await user.click(statusTrigger)
      expect(screen.getByRole('listbox', { name: 'Filter by cut status' })).toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: 'Rejected' }))
      expect(screen.queryByRole('listbox', { name: 'Filter by cut status' })).not.toBeInTheDocument()
      expect(statusTrigger).toHaveFocus()

      // Open spec dropdown and close via tab away (focusout)
      await user.click(specTrigger)
      expect(screen.getByRole('listbox', { name: 'Filter by specification status' })).toBeInTheDocument()
      await user.tab()
      expect(screen.queryByRole('listbox', { name: 'Filter by specification status' })).not.toBeInTheDocument()
    })

    it('renders KPI summary pills without unwanted inner border on Accepted on default load and activates when filtering', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const acceptedBtn = screen.getByRole('button', { name: 'Total accepted cuts' })
      expect(acceptedBtn).toHaveClass('production-kpi-pill', 'accepted')
      expect(acceptedBtn).not.toHaveClass('production-kpi-active')

      const specifiedBtn = screen.getByRole('button', { name: 'Filter specified cuts' })
      expect(specifiedBtn).toHaveClass('production-kpi-pill', 'specified')
      expect(specifiedBtn).not.toHaveClass('production-kpi-active')

      const unspecifiedBtn = screen.getByRole('button', { name: 'Filter unspecified cuts' })
      expect(unspecifiedBtn).toHaveClass('production-kpi-pill', 'unspecified')
      expect(unspecifiedBtn).not.toHaveClass('production-kpi-active')

      // Activate unspecified filter
      await user.click(unspecifiedBtn)
      expect(unspecifiedBtn).toHaveClass('production-kpi-active')
      expect(acceptedBtn).not.toHaveClass('production-kpi-active')
    })

    it('renders status filter dropdown in inactive state on load and activates when non-default option is selected', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const statusTrigger = screen.getByRole('button', { name: 'Filter by cut status' })
      expect(statusTrigger).not.toHaveClass('production-filter-btn-active')

      await user.click(statusTrigger)
      await user.click(screen.getByRole('option', { name: 'Rejected' }))

      expect(statusTrigger).toHaveClass('production-filter-btn-active')
    })

    it('renders tabular-data class on timestamps and formats empty values with production-placeholder', async () => {
      const payloadWithNullTimestamp = {
        ...mockProductionPayload,
        records: [
          {
            ...mockProductionPayload.records[0],
            recordedAt: null,
            timestamp: null,
          },
        ],
      }
      const mockLoad = vi.fn().mockResolvedValue(payloadWithNullTimestamp)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Maynilad Water')

      const timestampCell = screen.getByRole('cell', { name: '—' })
      expect(timestampCell).toHaveClass('production-col-timestamp', 'tabular-data')
      const placeholder = timestampCell.querySelector('.production-placeholder')
      expect(placeholder).not.toBeNull()
      expect(placeholder).toHaveTextContent('—')
    })
  })

  describe('Selective Batch Selection & hasInformation Contract', () => {
    it('hasInformation accurately identifies filled specification information vs pure auto-assigned pipeNumber', () => {
      // Null / empty cases
      expect(hasInformation(null)).toBe(false)
      expect(hasInformation(undefined)).toBe(false)
      expect(hasInformation({})).toBe(false)

      // Only auto-assigned pipeNumber present -> MUST return false so cut is selectable by header batch select-all
      expect(hasInformation({ pipeNumber: 1 })).toBe(false)
      expect(hasInformation({ pipeNumber: 42, outputAccepted: true })).toBe(false)

      // Blank or whitespace-only customer
      expect(hasInformation({ customer: '', pipeNumber: 1 })).toBe(false)
      expect(hasInformation({ customer: '   ', pipeNumber: 1 })).toBe(false)

      // When actual information is filled:
      expect(hasInformation({ customer: 'Maynilad Water' })).toBe(true)
      expect(hasInformation({ isSpecified: true })).toBe(true)
      expect(hasInformation({ diameter: 625.4 })).toBe(true)
      expect(hasInformation({ thickness: 12.7 })).toBe(true)
      expect(hasInformation({ length: 6000 })).toBe(true)
      expect(hasInformation({ label: 'Batch-101' })).toBe(true)
      expect(hasInformation({ size: '12 inch' })).toBe(true)
      expect(hasInformation({ radius: 312.7 })).toBe(true)
      expect(hasInformation({ circumference: 1964.8 })).toBe(true)
    })

    it('header select-all excludes outputs with information already filled up unless explicitly clicked by user', async () => {
      const user = userEvent.setup()
      const selectivePayload = {
        ...mockProductionPayload,
        records: [
          {
            id: 'cut-filled-1',
            sensorEventId: 'cut-filled-1',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: true,
            customer: 'Acme Corporation',
            diameter: 625.4,
            thickness: 12.7,
            length: 6000,
            pipeNumber: 1,
            tonnage: 1.1513,
            recordedAt: '2026-10-30T06:30:00+08:00',
          },
          {
            id: 'cut-unfilled-2',
            sensorEventId: 'cut-unfilled-2',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: false,
            customer: null,
            diameter: null,
            thickness: null,
            length: null,
            pipeNumber: 2,
            tonnage: null,
            recordedAt: '2026-10-30T07:00:00+08:00',
          },
          {
            id: 'cut-unfilled-3',
            sensorEventId: 'cut-unfilled-3',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: false,
            customer: null,
            diameter: null,
            thickness: null,
            length: null,
            pipeNumber: 3,
            tonnage: null,
            recordedAt: '2026-10-30T07:30:00+08:00',
          },
        ],
      }

      const mockBatchUpdate = vi.fn().mockResolvedValue({ matchedCount: 2, updatedCount: 2 })

      renderWithAuth(
        <ProductionSection
          loadProduction={vi.fn().mockResolvedValue(selectivePayload)}
          batchUpdateProductionSpecs={mockBatchUpdate}
        />,
      )

      await screen.findByText('Acme Corporation')

      const headerCheckbox = screen.getByLabelText('Select all cuts on this page')
      const filledRowCheckbox = screen.getByLabelText(/select cut at 2026-10-30T06:30:00/i)
      const unfilledRow2Checkbox = screen.getByLabelText(/select cut at 2026-10-30T07:00:00/i)
      const unfilledRow3Checkbox = screen.getByLabelText(/select cut at 2026-10-30T07:30:00/i)

      expect(headerCheckbox).not.toBeChecked()
      expect(filledRowCheckbox).not.toBeChecked()
      expect(unfilledRow2Checkbox).not.toBeChecked()
      expect(unfilledRow3Checkbox).not.toBeChecked()

      // Click Header Select-All: Should ONLY select cut 2 and cut 3, NOT cut 1 (Acme Corporation)
      await user.click(headerCheckbox)

      expect(filledRowCheckbox).not.toBeChecked()
      expect(unfilledRow2Checkbox).toBeChecked()
      expect(unfilledRow3Checkbox).toBeChecked()
      expect(screen.getByText('2 cuts selected')).toBeInTheDocument()

      // The user CAN explicitly choose to include the filled record by clicking its row checkbox directly
      await user.click(filledRowCheckbox)
      expect(filledRowCheckbox).toBeChecked()
      expect(unfilledRow2Checkbox).toBeChecked()
      expect(unfilledRow3Checkbox).toBeChecked()
      expect(screen.getByText('3 cuts selected')).toBeInTheDocument()

      // User unchecks the filled record manually
      await user.click(filledRowCheckbox)
      expect(filledRowCheckbox).not.toBeChecked()
      expect(screen.getByText('2 cuts selected')).toBeInTheDocument()

      // Deselect all
      await user.click(headerCheckbox)
      expect(filledRowCheckbox).not.toBeChecked()
      expect(unfilledRow2Checkbox).not.toBeChecked()
      expect(unfilledRow3Checkbox).not.toBeChecked()
      expect(screen.queryByText(/cuts selected/i)).not.toBeInTheDocument()
    })

    it('header checkbox is disabled when all cuts on the page already have information filled up', async () => {
      const allFilledPayload = {
        ...mockProductionPayload,
        records: [
          {
            id: 'cut-filled-1',
            sensorEventId: 'cut-filled-1',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: true,
            customer: 'Acme Corporation',
            diameter: 625.4,
            thickness: 12.7,
            length: 6000,
            pipeNumber: 1,
            tonnage: 1.1513,
            recordedAt: '2026-10-30T06:30:00+08:00',
          },
        ],
      }

      renderWithAuth(
        <ProductionSection
          loadProduction={vi.fn().mockResolvedValue(allFilledPayload)}
        />,
      )

      await screen.findByText('Acme Corporation')

      const headerCheckbox = screen.getByLabelText('Select all cuts on this page')
      expect(headerCheckbox).toBeDisabled()
    })
  })
})

