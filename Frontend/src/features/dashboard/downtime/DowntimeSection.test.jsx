import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import DowntimeSection from './DowntimeSection.jsx'
import { getDowntimeRecords, subscribeToDowntime, updateDowntimeRecord } from './downtimeService.js'

vi.mock('./downtimeService.js', () => ({
  getDowntimeRecords: vi.fn(),
  subscribeToDowntime: vi.fn(),
  updateDowntimeRecord: vi.fn(),
}))

function downtimeRecord(overrides = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    displayLabel: 'S-03 08:42 AM',
    machine: 'Spiral Mill 01',
    sensor: 'S-03',
    sensorLabel: 'Machine Main Sensor',
    cause: 'Pending Cause Review',
    startedAt: '2026-06-11T00:42:00.000Z',
    endedAt: null,
    durationMinutes: 12,
    status: 'Open',
    isOpen: true,
    isCauseEditable: true,
    needsCauseReview: true,
    notes: '',
    estimatedLoss: 28,
    ...overrides,
  }
}

describe('DowntimeSection', () => {
  beforeEach(() => {
    getDowntimeRecords.mockReset()
    subscribeToDowntime.mockReset()
    subscribeToDowntime.mockReturnValue(() => {})
    updateDowntimeRecord.mockReset()
  })

  it('renders a newly received downtime event without a page refresh', async () => {
    let streamHandlers
    const newRecord = downtimeRecord({
      id: '66666666-6666-4666-8666-666666666666',
      displayLabel: 'S-04 09:15 AM',
      sensor: 'S-04',
      sensorLabel: 'Outside Filler Wire',
      cause: 'Consumable Shortage',
      isCauseEditable: false,
      needsCauseReview: false,
    })

    getDowntimeRecords
      .mockResolvedValueOnce({
        records: [],
        summary: { open: 0, resolved: 0, minutes: 0, loss: 0 },
      })
      .mockResolvedValueOnce({
        records: [newRecord],
        summary: { open: 1, resolved: 0, minutes: 0, loss: 0 },
      })
    subscribeToDowntime.mockImplementation((token, handlers) => {
      expect(token).toBe('test-token')
      streamHandlers = handlers
      return () => {}
    })

    renderWithAuth(<DowntimeSection />)

    expect(await screen.findByText('No downtime records match the selected filters.')).toBeInTheDocument()

    await act(async () => {
      streamHandlers.onEvent({
        type: 'downtime.created',
        payload: { downtime: { id: newRecord.id, status: 'Open' } },
      })
    })

    expect(await screen.findByText('S-04 09:15 AM')).toBeInTheDocument()
    expect(screen.getAllByText('Consumable Shortage').length).toBeGreaterThan(1)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(getDowntimeRecords).toHaveBeenCalledTimes(2)
  })

  it('renders readable downtime labels and opens inline review details', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord()],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })

    renderWithAuth(<DowntimeSection />)

    expect(await screen.findByText('S-03 08:42 AM')).toBeInTheDocument()
    expect(screen.getByText('S-03 - Machine Main Sensor')).toBeInTheDocument()
    expect(screen.getByText('Needs cause review')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view details/i }))

    expect(screen.getByText('Downtime review')).toBeInTheDocument()
    expect(screen.getByText('Estimated loss')).toBeInTheDocument()
    expect(screen.getAllByText('28 pcs').length).toBeGreaterThan(0)
    const causeSelect = screen.getByLabelText('Cause for S-03 08:42 AM')
    expect(causeSelect).toHaveValue('Pending Cause Review')
    expect(within(causeSelect).getByRole('option', { name: 'Misalignment' })).toBeInTheDocument()
    expect(within(causeSelect).getByRole('option', { name: 'Consumable Shortage' })).toBeInTheDocument()
    expect(within(causeSelect).queryByRole('option', { name: 'Flux Refill' })).not.toBeInTheDocument()
  })

  it('renders downtime records read-only for assistant operation managers', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord()],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })

    renderWithAuth(<DowntimeSection />, {
      authValue: {
        user: {
          id: 'user-2',
          name: 'Assistant Manager',
          username: 'assistant',
          role: 'Asst. Operation Manager',
        },
      },
    })

    expect(await screen.findByText('Read only')).toBeInTheDocument()
    expect(screen.getByLabelText('Cause for S-03 08:42 AM')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.getByLabelText('Review notes')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument()
  })

  it('loads additional downtime pages through backend pagination', async () => {
    const user = userEvent.setup()
    const unsubscribe = vi.fn()
    subscribeToDowntime.mockReturnValue(unsubscribe)
    getDowntimeRecords
      .mockResolvedValueOnce({
        records: [downtimeRecord({ id: 'page-1' })],
        summary: { open: 30, resolved: 0, minutes: 12, loss: 28 },
        pagination: { page: 1, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
      })
      .mockResolvedValueOnce({
        records: [downtimeRecord({ id: 'page-2', displayLabel: 'S-03 09:42 AM' })],
        summary: { open: 30, resolved: 0, minutes: 12, loss: 28 },
        pagination: { page: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true },
      })

    renderWithAuth(<DowntimeSection />)
    await user.click(await screen.findByRole('button', { name: 'Next downtime page' }))

    expect(await screen.findByText('S-03 09:42 AM')).toBeInTheDocument()
    expect(getDowntimeRecords).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 2, limit: 25 }))
    expect(subscribeToDowntime).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('keeps one stream subscription and reloads the latest filter state after an event', async () => {
    const user = userEvent.setup()
    let streamHandlers
    const unsubscribe = vi.fn()
    subscribeToDowntime.mockImplementation((token, handlers) => {
      streamHandlers = handlers
      return unsubscribe
    })
    getDowntimeRecords
      .mockResolvedValueOnce({
        records: [downtimeRecord({ id: 'page-1' })],
        summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
        pagination: { page: 1, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
      })
      .mockResolvedValueOnce({
        records: [downtimeRecord({ id: 'page-2', displayLabel: 'S-03 09:42 AM' })],
        summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
        pagination: { page: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true },
      })
      .mockResolvedValueOnce({
        records: [downtimeRecord({ id: 'page-2', displayLabel: 'S-03 09:42 AM' })],
        summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
        pagination: { page: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true },
      })

    renderWithAuth(<DowntimeSection />)
    await user.click(await screen.findByRole('button', { name: 'Next downtime page' }))
    await screen.findByText('S-03 09:42 AM')

    await act(async () => {
      streamHandlers.onEvent({
        type: 'downtime.updated',
        payload: { downtime: { id: 'page-2', status: 'Open' } },
      })
    })

    await waitFor(() => {
      expect(getDowntimeRecords).toHaveBeenCalledTimes(3)
      expect(getDowntimeRecords).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 2, limit: 25 }))
    })
    expect(subscribeToDowntime).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('stops downtime fallback polling when the event stream recovers', async () => {
    let streamHandlers
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    subscribeToDowntime.mockImplementation((token, handlers) => {
      streamHandlers = handlers
      return () => {}
    })
    getDowntimeRecords.mockResolvedValue({
      records: [],
      summary: { open: 0, resolved: 0, minutes: 0, loss: 0 },
    })

    renderWithAuth(<DowntimeSection />)
    await screen.findByText('No downtime records match the selected filters.')

    await act(async () => {
      streamHandlers.onFallback()
    })
    const pollingId = setIntervalSpy.mock.results[0].value
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000)

    await act(async () => {
      streamHandlers.onRecovery()
    })
    expect(clearIntervalSpy).toHaveBeenCalledWith(pollingId)

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('saves inline notes and updates the downtime row', async () => {
    const user = userEvent.setup()
    const updatedRecord = downtimeRecord({
      notes: 'Operator confirmed coil joint replacement.',
    })

    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord()],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })
    updateDowntimeRecord.mockResolvedValue({ record: updatedRecord })

    renderWithAuth(<DowntimeSection />)

    await screen.findByText('S-03 08:42 AM')
    await user.click(screen.getByRole('button', { name: /view details/i }))
    await user.type(screen.getByLabelText(/review notes/i), 'Operator confirmed coil joint replacement.')
    await user.click(screen.getByRole('button', { name: /save notes/i }))

    await waitFor(() => {
      expect(updateDowntimeRecord).toHaveBeenCalledWith(
        'test-token',
        '55555555-5555-4555-8555-555555555555',
        { notes: 'Operator confirmed coil joint replacement.' },
      )
    })
    expect(await screen.findByText(/notes saved/i)).toBeInTheDocument()
  })

  it('reloads records when filters change and resolves a downtime record', async () => {
    const user = userEvent.setup()
    const resolvedRecord = downtimeRecord({
      status: 'Resolved',
      isOpen: false,
      endedAt: '2026-06-11T00:54:00.000Z',
    })

    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord()],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })
    updateDowntimeRecord.mockResolvedValue({ record: resolvedRecord })

    renderWithAuth(<DowntimeSection />)

    await screen.findByText('S-03 08:42 AM')
    await user.click(screen.getByRole('button', { name: 'Resolved' }))

    await waitFor(() => {
      expect(getDowntimeRecords).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ status: 'Resolved' }))
    })

    await user.click(screen.getByRole('button', { name: /^Resolve$/i }))

    await waitFor(() => {
      expect(updateDowntimeRecord).toHaveBeenCalledWith(
        'test-token',
        '55555555-5555-4555-8555-555555555555',
        { status: 'Resolved' },
      )
    })
    expect(await screen.findByText(/downtime resolved/i)).toBeInTheDocument()
  })

  it('locks cause editing when the backend assigns the cause from the sensor', async () => {
    getDowntimeRecords.mockResolvedValue({
      records: [
        downtimeRecord({
          displayLabel: 'S-04 08:42 AM',
          sensor: 'S-04',
          sensorLabel: 'Outside Filler Wire',
          cause: 'Consumable Shortage',
          isCauseEditable: false,
          needsCauseReview: false,
        }),
      ],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })

    renderWithAuth(<DowntimeSection />)

    expect(await screen.findByText('S-04 08:42 AM')).toBeInTheDocument()
    expect(screen.getByText('S-04 - Outside Filler Wire')).toBeInTheDocument()
    expect(screen.queryByText('Needs cause review')).not.toBeInTheDocument()
    expect(screen.getAllByText('Consumable Shortage').length).toBeGreaterThan(1)
    expect(screen.queryByLabelText(/cause for s-04/i)).not.toBeInTheDocument()
  })
})
