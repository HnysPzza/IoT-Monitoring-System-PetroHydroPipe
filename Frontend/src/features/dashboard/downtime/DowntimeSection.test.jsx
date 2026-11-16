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
  it('F05 exposes failed background reads and reconciles while the stream is connected', async () => {
    const timer = vi.spyOn(window, 'setInterval')
    getDowntimeRecords.mockResolvedValueOnce({ records: [downtimeRecord()] })
      .mockRejectedValueOnce(new Error('Read failed'))
      .mockResolvedValue({ records: [downtimeRecord({ displayLabel: 'Fresh result' })] })
    const view = renderWithAuth(<DowntimeSection />)
    await screen.findByText('S-03 08:42 AM')
    await act(async () => { subscribeToDowntime.mock.calls[0][1].onEvent({ payload: { downtime: { id: 'new' } } }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Downtime data is stale')
    expect(screen.getByText('S-03 08:42 AM')).toBeInTheDocument()
    await act(async () => { timer.mock.calls.find(([, delay]) => delay === 60000)[0]() })
    expect(await screen.findByText('Fresh result')).toBeInTheDocument()
    expect(screen.queryByText(/Downtime data is stale/)).not.toBeInTheDocument()
    view.unmount()
    timer.mockRestore()
  })
  it('F04 review keeps the current filter when an old request completes', async () => {
    const user = userEvent.setup()
    let resolveOld
    getDowntimeRecords.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValue({ records: [downtimeRecord({ displayLabel: 'Resolved result', status: 'Resolved', isOpen: false })] })
    renderWithAuth(<DowntimeSection />)
    await user.selectOptions(screen.getByLabelText('Cause'), 'Misalignment')
    await screen.findByText('Resolved result')
    await act(async () => { resolveOld({ records: [downtimeRecord({ displayLabel: 'Old open result' })] }) })
    expect(screen.queryByText('Old open result')).not.toBeInTheDocument()
    expect(screen.getByText('Resolved result')).toBeInTheDocument()
  })
  it('F04 ignores an older response arriving after a realtime refresh', async () => {
    let resolveOld
    const old = new Promise((resolve) => { resolveOld = resolve })
    getDowntimeRecords.mockReturnValueOnce(old).mockResolvedValue({ records: [downtimeRecord({ displayLabel: 'Current record' })] })
    renderWithAuth(<DowntimeSection />)
    await waitFor(() => expect(getDowntimeRecords).toHaveBeenCalledTimes(1))
    await act(async () => {
      subscribeToDowntime.mock.calls[0][1].onEvent({ payload: { downtime: { id: 'new' } } })
    })
    await act(async () => { resolveOld({ records: [downtimeRecord({ displayLabel: 'Old record' })] }) })
    expect(screen.queryByText('Old record')).not.toBeInTheDocument()
    expect(await screen.findByText('Current record')).toBeInTheDocument()
  })
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
      lossEstimateBasis: { source: 'trailing-30-days', ratePiecesPerMinute: 0.075 },
    })

    renderWithAuth(<DowntimeSection />)

    expect(await screen.findByText('S-03 08:42 AM')).toBeInTheDocument()
    expect(screen.getByText('Jun 11, 2026')).toBeInTheDocument()
    expect(screen.getByText('S-03 - Machine Main Sensor')).toBeInTheDocument()
    expect(screen.getByText('Needs cause review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Resolve$/i })).not.toBeInTheDocument()
    expect(screen.getByText('Sensor-managed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view details/i }))

    expect(screen.getByText('Downtime review')).toBeInTheDocument()
    expect(screen.getByText('Estimated loss')).toBeInTheDocument()
    expect(screen.getAllByText('28 pcs').length).toBeGreaterThan(0)
    expect(screen.getByText('Last 30 completed days: 5 pcs/hr')).toBeInTheDocument()
    const causeSelect = screen.getByLabelText('Cause for S-03 08:42 AM')
    expect(causeSelect).toHaveValue('Pending Cause Review')
    expect(within(causeSelect).getByRole('option', { name: 'Misalignment' })).toBeInTheDocument()
    expect(within(causeSelect).getByRole('option', { name: 'Consumable Shortage' })).toBeInTheDocument()
    expect(within(causeSelect).queryByRole('option', { name: 'Flux Refill' })).not.toBeInTheDocument()
  })

  it('renders downtime records read-only for quality control inspectors', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord()],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })

    renderWithAuth(<DowntimeSection />, {
      authValue: {
        user: {
          id: 'user-2',
          name: 'QC Inspector',
          username: 'qcinspector',
          role: 'Quality Control',
        },
      },
    })

    expect(await screen.findByText('Sensor-managed')).toBeInTheDocument()
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
    const pollingIndex = setIntervalSpy.mock.calls.findIndex(([, delay]) => delay === 10000)
    const pollingId = setIntervalSpy.mock.results[pollingIndex].value
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

  it('reloads records when filters change without offering manual resolution', async () => {
    const user = userEvent.setup()

    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord({ cause: 'Misalignment', needsCauseReview: false })],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })

    renderWithAuth(<DowntimeSection />)

    await screen.findByText('S-03 08:42 AM')
    await user.selectOptions(screen.getByLabelText('Cause'), 'Misalignment')

    await waitFor(() => {
      expect(getDowntimeRecords).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ cause: 'Misalignment' }))
    })
    expect(screen.queryByRole('button', { name: /^Resolve$/i })).not.toBeInTheDocument()
    expect(updateDowntimeRecord).not.toHaveBeenCalled()
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

  it('explains the default 30-day window when the date filter is cleared', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValueOnce({ records: [downtimeRecord()] })
      .mockResolvedValue({
        records: [downtimeRecord()],
        range: { start: '2026-06-13T16:00:00.000Z', end: '2026-07-13T16:00:00.000Z', isDefault: true },
      })

    renderWithAuth(<DowntimeSection />)

    await screen.findByText('S-03 08:42 AM')
    expect(screen.queryByText(/Showing the last 30 days/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear date' }))
    expect(await screen.findByText(/Showing the last 30 days/)).toBeInTheDocument()
    expect(getDowntimeRecords).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ date: '' }))
  })

  it('offers Daily, Weekly, Monthly, and Custom Range presets on the downtime calendar', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord()],
      summary: { open: 1, resolved: 2, minutes: 12, loss: 28 },
    })

    renderWithAuth(<DowntimeSection />)
    await screen.findByText('S-03 08:42 AM')

    await user.click(screen.getByRole('button', { name: 'Select downtime date' }))
    expect(screen.getByRole('button', { name: 'Daily' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monthly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom Range' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(getDowntimeRecords).toHaveBeenLastCalledWith(
        'test-token',
        expect.objectContaining({
          dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
    })
  })

  it('renders page heading, semantic status tones, and only attaches aria-controls when details are expanded', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [
        downtimeRecord({ id: 'open-1', status: 'Open', needsCauseReview: true }),
        downtimeRecord({
          id: 'resolved-2',
          displayLabel: 'S-04 09:10 AM',
          sensor: 'S-04',
          sensorLabel: 'Outside Filler Wire',
          cause: 'Consumable Shortage',
          status: 'Resolved',
          isOpen: false,
          isCauseEditable: false,
          needsCauseReview: false,
        }),
      ],
      summary: { open: 1, resolved: 1, minutes: 24, loss: 56 },
    })

    renderWithAuth(<DowntimeSection />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Downtime' })).toBeInTheDocument()
    const needsReviewBadge = (await screen.findByText('Needs cause review')).closest('.status')
    expect(needsReviewBadge).toHaveClass('status-fault')

    const resolvedBadge = screen.getByText('Resolved', { selector: '.status' })
    expect(resolvedBadge.querySelector('.status-dot-active')).not.toBeNull()

    const [firstDetailsButton] = screen.getAllByRole('button', { name: 'View details' })
    expect(firstDetailsButton).not.toHaveAttribute('aria-controls')

    await user.click(firstDetailsButton)
    const hideDetailsButton = screen.getByRole('button', { name: 'Hide details' })
    expect(hideDetailsButton).toHaveAttribute('aria-controls', 'downtime-details-open-1')
  })

  it('filters downtime records by status and keeps committed period label until calendar preset is applied', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord()],
      summary: { open: 2, resolved: 3, minutes: 18, loss: 42 },
    })

    renderWithAuth(<DowntimeSection />)
    await screen.findByText('S-03 08:42 AM')

    expect(screen.getByText('Resolved Today')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select downtime date' }))
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.getByText('Resolved Today')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Status'), 'Open')
    await waitFor(() => {
      expect(getDowntimeRecords).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ status: 'Open' }))
    })
  })

  it('shows note character count, allows discarding unsaved note drafts, and explains read-only role restrictions', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [downtimeRecord({ notes: 'Initial note' })],
      summary: { open: 1, resolved: 0, minutes: 12, loss: 28 },
    })

    const supervisorView = renderWithAuth(<DowntimeSection />)
    await screen.findByText('S-03 08:42 AM')

    await user.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.getByText('12 / 1000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Review notes'), ' updated')
    expect(screen.getByText('20 / 1000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByLabelText('Review notes')).toHaveValue('Initial note')
    supervisorView.unmount()

    renderWithAuth(<DowntimeSection />, {
      authValue: {
        user: {
          id: 'user-2',
          name: 'QC Inspector',
          username: 'qcinspector',
          role: 'Quality Control',
        },
      },
    })
    await screen.findByText('S-03 08:42 AM')
    await user.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.getByText(/Read-only for Quality Control/i)).toBeInTheDocument()
  })

  it('renders custom select wrappers and chevrons on downtime filters and editable cause dropdowns', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [
        downtimeRecord({ id: 'editable-1', displayLabel: 'S-03 08:42 AM', isCauseEditable: true }),
        downtimeRecord({
          id: 'locked-2',
          displayLabel: 'S-04 09:00 AM',
          sensor: 'S-04',
          sensorLabel: 'Outside Filler Wire',
          cause: 'Consumable Shortage',
          isCauseEditable: false,
          needsCauseReview: false,
        }),
      ],
      summary: { open: 2, resolved: 0, minutes: 24, loss: 56 },
    })
    updateDowntimeRecord.mockResolvedValue({
      record: downtimeRecord({ id: 'editable-1', displayLabel: 'S-03 08:42 AM', cause: 'Misalignment', needsCauseReview: false }),
    })

    renderWithAuth(<DowntimeSection />)
    await screen.findByText('S-03 08:42 AM')

    const causeFilter = screen.getByLabelText('Cause')
    const statusFilter = screen.getByLabelText('Status')
    const inlineCauseSelect = screen.getByLabelText('Cause for S-03 08:42 AM')

    for (const selectElement of [causeFilter, statusFilter, inlineCauseSelect]) {
      const wrapper = selectElement.closest('.custom-select-wrap.downtime-select-wrap')
      expect(wrapper).not.toBeNull()
      const chevron = wrapper.querySelector('.select-chevron-icon')
      expect(chevron).toBeInTheDocument()
      expect(chevron).toHaveAttribute('aria-hidden', 'true')
    }

    expect(inlineCauseSelect.closest('.downtime-inline-select-wrap')).not.toBeNull()
    expect(screen.queryByLabelText('Cause for S-04 09:00 AM')).not.toBeInTheDocument()

    await user.selectOptions(inlineCauseSelect, 'Misalignment')
    await waitFor(() => {
      expect(updateDowntimeRecord).toHaveBeenCalledWith('test-token', 'editable-1', { cause: 'Misalignment' })
    })
  })

  it('renders the Outside schedule badge and detail explanation when a fault occurs outside scheduled production time', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [
        downtimeRecord({
          id: 'sunday-fault-1',
          displayLabel: 'S-03 10:00 AM',
          startedAt: '2026-11-22T02:00:00.000Z',
          endedAt: '2026-11-22T02:45:00.000Z',
          durationMinutes: 45,
          unplannedMinutes: 0,
          plannedExcludedMinutes: 45,
          estimatedLoss: 0,
          outsideSchedule: true,
          status: 'Resolved',
          isOpen: false,
        }),
      ],
      summary: { open: 0, resolved: 1, minutes: 45, loss: 0 },
    })

    renderWithAuth(<DowntimeSection />)

    expect(await screen.findByText('S-03 10:00 AM')).toBeInTheDocument()
    const outsideBadge = screen.getByText('Outside schedule')
    expect(outsideBadge.closest('.status')).toHaveClass('status-offline')

    await user.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.getByText('Schedule status')).toBeInTheDocument()
    expect(
      screen.getByText(/occurred outside scheduled production time.*unplanned downtime is 0 min.*estimated loss is 0 pcs/i),
    ).toBeInTheDocument()
  })

  it('does not render the Outside schedule badge for a short working-hour downtime event that rounds to zero minutes', async () => {
    const user = userEvent.setup()
    getDowntimeRecords.mockResolvedValue({
      records: [
        downtimeRecord({
          id: 'short-working-fault-1',
          displayLabel: 'S-03 09:00 AM',
          startedAt: '2026-11-23T01:00:00.000Z',
          endedAt: null,
          durationMinutes: 0,
          unplannedMinutes: 0,
          plannedExcludedMinutes: 0,
          estimatedLoss: 0,
          outsideSchedule: false,
          status: 'Open',
          isOpen: true,
        }),
      ],
      summary: { open: 1, resolved: 0, minutes: 0, loss: 0 },
    })

    renderWithAuth(<DowntimeSection />)

    expect(await screen.findByText('S-03 09:00 AM')).toBeInTheDocument()
    expect(screen.queryByText('Outside schedule')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.queryByText('Schedule status')).not.toBeInTheDocument()
    expect(screen.queryByText(/occurred outside scheduled production time/i)).not.toBeInTheDocument()
  })
})
