import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { apiRequest } from '../../../shared/services/apiClient.js'
import { getProductionLogs, updateProductionLogSpec } from './productionService.js'
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
      label: null,
      size: null,
      diameter: null,
      radius: null,
      circumference: null,
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
      label: null,
      size: null,
      diameter: null,
      radius: null,
      circumference: null,
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

  it('propagates API client errors', async () => {
    apiRequest.mockRejectedValueOnce(new Error('Network failure'))

    await expect(getProductionLogs('mock-token')).rejects.toThrow('Network failure')
  })
})

describe('productionService updateProductionLogSpec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls apiRequest with PATCH, flat body, and expectedUpdatedAt', async () => {
    apiRequest.mockResolvedValueOnce({ spec: { label: 'Updated Pipe' } })

    const spec = {
      label: 'Batch Beta Pipe',
      size: '8 inch',
      diameter: 203.2,
      radius: 101.6,
      circumference: 638.37,
    }
    const expectedUpdatedAt = '2026-10-30T06:30:00.000Z'

    await updateProductionLogSpec('mock-token', 'e0000000-0000-4000-8000-000000000001', spec, expectedUpdatedAt)

    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith('/api/production/e0000000-0000-4000-8000-000000000001', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        label: 'Batch Beta Pipe',
        size: '8 inch',
        diameter: 203.2,
        radius: 101.6,
        circumference: 638.37,
        expectedUpdatedAt: '2026-10-30T06:30:00.000Z',
      },
    })
  })

  it('handles null and undefined specification fields and optional expectedUpdatedAt', async () => {
    apiRequest.mockResolvedValueOnce({ spec: { label: null } })

    await updateProductionLogSpec('mock-token', 'e0000000-0000-4000-8000-000000000001', {})

    expect(apiRequest).toHaveBeenCalledWith('/api/production/e0000000-0000-4000-8000-000000000001', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        label: null,
        size: null,
        diameter: null,
        radius: null,
        circumference: null,
      },
    })
  })

  it('converts empty strings to null and numeric strings to numbers', async () => {
    apiRequest.mockResolvedValueOnce({ spec: { label: null } })

    await updateProductionLogSpec(
      'mock-token',
      'e0000000-0000-4000-8000-000000000001',
      {
        label: '   ',
        size: '',
        diameter: '152.4',
        radius: '',
        circumference: 478.78,
      },
      null,
    )

    expect(apiRequest).toHaveBeenCalledWith('/api/production/e0000000-0000-4000-8000-000000000001', {
      token: 'mock-token',
      method: 'PATCH',
      body: {
        label: null,
        size: null,
        diameter: 152.4,
        radius: null,
        circumference: 478.78,
        expectedUpdatedAt: null,
      },
    })
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
        { label: 'Pipe' },
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
      updateProductionLogSpec('mock-token', 'e0000000-0000-4000-8000-000000000001', { label: 'Pipe' }),
    ).rejects.toThrow('Network error')
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

  it('strictly adheres to Step 6 guardrails and permissions', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    // Admin has edit buttons for accepted cuts
    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Batch Alpha Pipe')

    const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
    expect(editButtons.length).toBe(2)

    // No bulk edit bar or checkboxes (reserved for Step 7)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/apply to/i)).not.toBeInTheDocument()

    // No export button
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })

  describe('role-based authorization', () => {
    const allowedRoles = ['Admin', 'Operation Manager', 'Production Supervisor']
    const readOnlyRoles = ['Asst. Operation Manager', 'Engineering Supervisor', 'Operator']

    allowedRoles.forEach((role) => {
      it(`renders edit controls and Action column for authorized role: ${role}`, async () => {
        const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

        renderWithAuth(<ProductionSection loadProduction={mockLoad} />, {
          authValue: { user: { role } },
        })

        expect(await screen.findByText('Batch Alpha Pipe')).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument()
        const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
        expect(editButtons.length).toBe(2)
      })
    })

    readOnlyRoles.forEach((role) => {
      it(`strictly hides edit controls and Action column for view-only role: ${role}`, async () => {
        const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

        renderWithAuth(<ProductionSection loadProduction={mockLoad} />, {
          authValue: { user: { role } },
        })

        expect(await screen.findByText('Batch Alpha Pipe')).toBeInTheDocument()
        expect(screen.queryByRole('columnheader', { name: 'Action' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
      })
    })
  })

  it('enforces view-only constraint for rejected cuts even for Admin role', async () => {
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Batch Alpha Pipe')
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

    await screen.findByText('Batch Alpha Pipe')
    const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
    await user.click(editButtons[0])

    const labelInput = screen.getByLabelText('Specification label')
    expect(labelInput).toHaveValue('Batch Alpha Pipe')

    const sizeInput = screen.getByLabelText('Specification size')
    expect(sizeInput).toHaveValue('6 inch')

    const diameterInput = screen.getByLabelText('Specification diameter')
    expect(diameterInput).toHaveValue(152.4)

    const radiusInput = screen.getByLabelText('Specification radius')
    expect(radiusInput).toHaveValue(76.2)

    const circumferenceInput = screen.getByLabelText('Specification circumference')
    expect(circumferenceInput).toHaveValue(478.78)

    expect(screen.getByRole('button', { name: 'Save specification' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeInTheDocument()
  })

  it('supports Tab and Shift+Tab navigation across inline inputs', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

    await screen.findByText('Batch Alpha Pipe')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const labelInput = screen.getByLabelText('Specification label')
    const sizeInput = screen.getByLabelText('Specification size')
    const diameterInput = screen.getByLabelText('Specification diameter')

    labelInput.focus()
    expect(labelInput).toHaveFocus()

    await user.tab()
    expect(sizeInput).toHaveFocus()

    await user.tab()
    expect(diameterInput).toHaveFocus()

    await user.tab({ shift: true })
    expect(sizeInput).toHaveFocus()
  })

  it('saves inline edit on Enter key press', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn().mockResolvedValue({
      spec: {
        sensorEventId: 'e0000000-0000-4000-8000-000000000001',
        label: 'Batch Alpha 2',
        size: '6 inch',
        diameter: 152.4,
        radius: 76.2,
        circumference: 478.78,
        isSpecified: true,
        specStatus: 'specified',
        updatedAt: '2026-10-30T09:00:00.000Z',
      },
    })

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Batch Alpha Pipe')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const labelInput = screen.getByLabelText('Specification label')
    await user.clear(labelInput)
    await user.type(labelInput, 'Batch Alpha 2{Enter}')

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'test-token',
        'e0000000-0000-4000-8000-000000000001',
        expect.objectContaining({ label: 'Batch Alpha 2' }),
        '2026-10-30T06:30:00.000Z',
      )
    })

    expect(await screen.findByText('Batch Alpha 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Specification label')).not.toBeInTheDocument()
  })

  it('cancels inline edit on Escape key press and restores previous values', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn()

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Batch Alpha Pipe')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const labelInput = screen.getByLabelText('Specification label')
    await user.clear(labelInput)
    await user.type(labelInput, 'Unsaved Modified Label{Escape}')

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Specification label')).not.toBeInTheDocument()
    expect(screen.getByText('Batch Alpha Pipe')).toBeInTheDocument()
  })

  it('cancels inline edit on Cancel button click', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn()

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Batch Alpha Pipe')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const labelInput = screen.getByLabelText('Specification label')
    await user.clear(labelInput)
    await user.type(labelInput, 'Discarded Label')
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }))

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Specification label')).not.toBeInTheDocument()
    expect(screen.getByText('Batch Alpha Pipe')).toBeInTheDocument()
  })

  it('optimistically updates row values and applies 150ms flash class upon save', async () => {
    const user = userEvent.setup()
    let resolveUpdate
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve
    })
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn().mockReturnValue(updatePromise)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Batch Alpha Pipe')
    const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
    await user.click(editButtons[1]) // row 2 was unspecified

    const labelInput = screen.getByLabelText('Specification label')
    await user.type(labelInput, 'Optimistic Pipe')
    await user.click(screen.getByRole('button', { name: 'Save specification' }))

    // Immediate optimistic update
    expect(screen.getByText('Optimistic Pipe')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    const editedRow = rows[2]
    expect(editedRow).toHaveClass('production-row-flash')

    // Resolve backend update
    resolveUpdate({
      spec: {
        sensorEventId: 'e0000000-0000-4000-8000-000000000002',
        label: 'Optimistic Pipe',
        size: null,
        diameter: null,
        radius: null,
        circumference: null,
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
            label: 'Server Updated Batch Pipe',
            updatedAt: '2026-10-30T08:00:00.000Z',
          },
          ...mockProductionPayload.records.slice(1),
        ],
      })

    const mockUpdate = vi.fn().mockRejectedValueOnce(conflictError)

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Batch Alpha Pipe')
    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[0])

    const labelInput = screen.getByLabelText('Specification label')
    await user.clear(labelInput)
    await user.type(labelInput, 'Conflicting Change')
    await user.click(screen.getByRole('button', { name: 'Save specification' }))

    // Assert conflict notice alert
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/modified by another user/i)

    // Assert reload was triggered to sync server data
    await waitFor(() => {
      expect(mockLoad).toHaveBeenCalledTimes(2)
    })

    // Assert server value is rendered after reload
    expect(await screen.findByText('Server Updated Batch Pipe')).toBeInTheDocument()
    expect(screen.queryByText('Conflicting Change')).not.toBeInTheDocument()
  })

  it('rolls back optimistic state on generic network error', async () => {
    const user = userEvent.setup()
    const mockLoad = vi.fn().mockResolvedValue(mockProductionPayload)
    const mockUpdate = vi.fn().mockRejectedValueOnce(new Error('Network connection dropped'))

    renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

    await screen.findByText('Batch Alpha Pipe')
    const kpiRegion = screen.getByRole('region', { name: 'Production Summary Metrics' })
    expect(within(kpiRegion).getByText('30')).toBeInTheDocument() // specified count

    await user.click(screen.getAllByRole('button', { name: /edit specification/i })[1]) // row 2 (unspecified)
    const labelInput = screen.getByLabelText('Specification label')
    await user.type(labelInput, 'Temporary Pipe')
    await user.click(screen.getByRole('button', { name: 'Save specification' }))

    // Error alert displayed
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Network connection dropped')

    // Rolled back
    expect(screen.queryByText('Temporary Pipe')).not.toBeInTheDocument()
    expect(within(kpiRegion).getByText('30')).toBeInTheDocument()
  })
})
