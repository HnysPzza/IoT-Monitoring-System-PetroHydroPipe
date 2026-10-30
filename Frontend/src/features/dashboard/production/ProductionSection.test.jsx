import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { apiRequest } from '../../../shared/services/apiClient.js'
import { getProductionLogs } from './productionService.js'
import ProductionSection, { formatManilaDateTime, getManilaDateInputValue } from './ProductionSection.jsx'

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
      label: 'Batch Alpha Pipe',
      size: '6 inch',
      diameter: 152.4,
      radius: 76.2,
      circumference: 478.78,
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
      label: null,
      size: null,
      diameter: null,
      radius: null,
      circumference: null,
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
      label: null,
      size: null,
      diameter: null,
      radius: null,
      circumference: null,
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

  it('propagates API client errors', async () => {
    apiRequest.mockRejectedValueOnce(new Error('Network failure'))

    await expect(getProductionLogs('mock-token')).rejects.toThrow('Network failure')
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

    // Heading and dynamic sensor identity
    expect(await screen.findByRole('heading', { level: 1, name: 'Production Logs' })).toBeInTheDocument()
    expect(screen.getByText(/S-05 - Production Output Cutting/i)).toBeInTheDocument()
    expect(screen.getByText(/Production Output Cutting cuts and product specifications/i)).toBeInTheDocument()

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
    expect(await screen.findByText('Batch Alpha Pipe')).toBeInTheDocument()
    expect(screen.getByText('6 inch')).toBeInTheDocument()
    expect(screen.getByText('152.40')).toBeInTheDocument()
    expect(screen.getByText('76.20')).toBeInTheDocument()
    expect(screen.getByText('478.78')).toBeInTheDocument()
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

  it('handles date filter changes and queries with updated date', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Batch Alpha Pipe')

    const dateInput = screen.getByLabelText('Filter by date')
    await user.clear(dateInput)
    await user.type(dateInput, '2026-10-25')

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        date: '2026-10-25',
        page: 1,
      }))
    })
  })

  it('handles cut status filter changes', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Batch Alpha Pipe')

    const statusSelect = screen.getByLabelText('Filter by cut status')
    await user.selectOptions(statusSelect, 'rejected')

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

    await screen.findByText('Batch Alpha Pipe')

    const specSelect = screen.getByLabelText('Filter by specification status')
    await user.selectOptions(specSelect, 'unspecified')

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        specStatus: 'unspecified',
        page: 1,
      }))
    })
  })

  it('handles search input with Enter key submission', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Batch Alpha Pipe')

    const searchInput = screen.getByLabelText('Search production cuts')
    await user.type(searchInput, 'Batch Beta{Enter}')

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith('test-token', expect.objectContaining({
        search: 'Batch Beta',
        page: 1,
      }))
    })
  })

  it('handles pagination navigation next and previous', async () => {
    const user = userEvent.setup()
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
            label: 'Page Two Pipe',
            size: '8 inch',
            diameter: 203.2,
            radius: 101.6,
            circumference: 638.37,
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

    expect(await screen.findByText('Page Two Pipe')).toBeInTheDocument()
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

    expect(await screen.findByText('Batch Alpha Pipe')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('strictly adheres to Step 5 read-only guardrails', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Batch Alpha Pipe')

    // No edit buttons or pencil icons
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(document.querySelector('.lucide-pencil')).not.toBeInTheDocument()

    // No bulk edit bar or checkboxes
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/apply to/i)).not.toBeInTheDocument()

    // No export button
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })
})
