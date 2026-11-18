import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import '../../../shared/components/ui/Calendar.jsx'
import AuditSection from './AuditSection.jsx'
import { getAuditLogs } from './auditService.js'
import {
  auditActionGroups,
  auditActionOptions,
  auditEntityOptions,
  getAuditTone,
  getReadableAction,
  getReadableDetails,
  getReadableEntity,
  getReadableTarget,
  isEntityAllowedForAction,
} from './auditFormatters.js'

vi.mock('./auditService.js', () => ({
  getAuditLogs: vi.fn(),
}))

const originalShowModal = HTMLDialogElement.prototype.showModal
const originalClose = HTMLDialogElement.prototype.close

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal
  HTMLDialogElement.prototype.close = originalClose
})

describe('AuditSection', () => {
  beforeEach(() => {
    getAuditLogs.mockReset()
    act(() => {
      onlineManager.setOnline(true)
    })
  })

  afterEach(() => {
    act(() => {
      onlineManager.setOnline(true)
    })
  })

  it('formats all backend actions, entity types, roles, and semantic tones without leaking raw role names', () => {
    const newBackendActions = [
      ['REFRESH_TOKEN_REUSED', 'auth', {}],
      ['SETTINGS_UPDATED', 'machine_settings', { changedSections: ['sensorThresholds'] }],
      ['PRODUCTION_CALENDAR_DAY_SET', 'production_calendar', { calendarDate: '2026-12-25', name: 'Christmas Day', dayType: 'holiday', isWorking: true }],
      ['PRODUCTION_CALENDAR_RANGE_SET', 'production_calendar', { startDate: '2026-12-23', endDate: '2027-01-03', dayCount: 12, name: 'Christmas Shutdown', dayType: 'day_off' }],
      ['PRODUCTION_CALENDAR_ENTRY_REMOVED', 'production_calendar', { mode: 'single', calendarDate: '2026-12-24', previous: { name: 'Plant Cleaning', dayType: 'day_off' } }],
      ['PRODUCTION_SPEC_UPDATED', 'sensor_event', { sensorCode: 'S-05', label: 'Pipe A' }],
      ['PRODUCTION_SPEC_BATCH_UPDATED', 'sensor_event', { sensorCode: 'S-05', matchedCount: 4, updatedCount: 3 }],
      ['REPORT_EXPORTED', 'report', { reportCategory: 'production', format: 'pdf' }],
      ['WATCHDOG_DOWNTIME_CREATED', 'downtime', { ownerSensorCode: 'S-03', sensorCode: 'S-02' }],
      ['MACHINE_STATUS_RECONCILED', 'machine', { machineCode: 'M-01', newStatus: 'Running' }],
    ]

    for (const [action, entityType, metadata] of newBackendActions) {
      const log = { action, entityType, entityId: 'id-1', metadata }
      expect(getReadableAction(log)).not.toBe('System action recorded')
      expect(getReadableDetails(log)).not.toBe('System action was recorded.')
      expect(auditActionOptions.some((option) => option.value === action)).toBe(true)
      expect(auditActionGroups.some((group) => group.options.some((option) => option.value === action))).toBe(true)
    }

    const legacyWatchdog = { action: 'WATCHDOG_DOWNTIME_CONFIRMED', entityType: 'downtime', metadata: { sensorCode: 'S-02' } }
    expect(getReadableAction(legacyWatchdog)).not.toBe('System action recorded')
    expect(getReadableDetails(legacyWatchdog)).not.toBe('System action was recorded.')
    expect(getReadableAction({ action: 'constructor', entityType: 'constructor' })).toBe('Constructor')
    expect(getReadableEntity({ action: 'constructor', entityType: 'constructor' })).toBe('Constructor')
    expect(isEntityAllowedForAction('constructor', 'auth')).toBe(true)

    const groupedLabels = auditActionGroups.flatMap((group) => group.options.map((option) => option.label))
    expect(new Set(groupedLabels).size).toBe(groupedLabels.length)
    const groupedValues = new Set(auditActionGroups.flatMap((group) => group.options.map((option) => option.value)))
    for (const removed of ['WATCHDOG_DOWNTIME_CONFIRMED', 'USER_CREATED', 'MACHINE_STATUS_UPDATED', 'SENSOR_STATUS_UPDATED']) {
      expect(groupedValues.has(removed)).toBe(false)
    }

    for (const entityType of ['machine_settings', 'production_calendar', 'report', 'sensor_connectivity']) {
      expect(auditEntityOptions.some((option) => option.value === entityType)).toBe(true)
    }

    expect(getReadableTarget({ entityType: 'sensor_connectivity', metadata: { sensorCode: 'S-03' } }))
      .toContain('S-03')
    expect(getReadableTarget({ entityType: 'downtime', metadata: { ownerSensorCode: 'S-03' } }))
      .toContain('S-03')
    expect(getReadableTarget({ entityType: 'machine_settings', metadata: { machineName: 'Spiral Mill 01' } }))
      .toBe('Spiral Mill 01')
    expect(getReadableTarget({ entityType: 'production_calendar', metadata: { machineName: 'Spiral Mill 01' } }))
      .toBe('Spiral Mill 01')

    const createdAdmin = {
      action: 'USER_CREATED',
      entityType: 'user',
      targetUser: { username: 'director02' },
      metadata: { targetRole: 'Admin' },
    }
    expect(getReadableDetails(createdAdmin)).toBe('director02 was created as Managing Director.')
    expect(getReadableDetails(createdAdmin)).not.toMatch(/\bAdmin\b/)

    expect(getAuditTone({ action: 'LOGIN_FAILED' })).toBe('danger')
    expect(getAuditTone({ action: 'REFRESH_TOKEN_REUSED' })).toBe('danger')
    expect(getAuditTone({ action: 'SENSOR_MANUAL_RECOVERY_OVERRIDE' })).toBe('warning')
    expect(getAuditTone({ action: 'WATCHDOG_DOWNTIME_RESOLVED' })).toBe('success')
    expect(getAuditTone({ action: 'SETTINGS_UPDATED' })).toBe('neutral')
    expect(getAuditTone({ action: 'IOT_MACHINE_STATUS_UPDATED', metadata: { newStatus: 'Downtime' } })).toBe('danger')
    expect(getAuditTone({ action: 'IOT_MACHINE_STATUS_UPDATED', metadata: { newStatus: 'Running' } })).toBe('success')
    expect(getAuditTone({ action: 'MACHINE_STATUS_RECONCILED', metadata: { newStatus: 'Running' } })).toBe('success')
    expect(getAuditTone({ action: 'USER_STATUS_UPDATED', metadata: { newStatus: 'Active' } })).toBe('success')
    expect(getAuditTone({ action: 'PASSWORD_RESET_COMPLETED' })).toBe('success')
    expect(getAuditTone({ action: 'USER_PASSWORD_RESET_REQUESTED' })).toBe('warning')
  })

  it('formats user account audit actions and affected accounts', () => {
    const events = [
      ['USER_INVITED', 'User account invited', 'operator01 was invited.'],
      ['USER_INVITATION_RESENT', 'Invitation resend requested', 'A new invitation link was requested for operator01.'],
      ['USER_PASSWORD_RESET_REQUESTED', 'Password reset requested', 'A password reset was requested for operator01.'],
      ['PASSWORD_SETUP_COMPLETED', 'Password setup completed', 'operator01 completed password setup.'],
      ['PASSWORD_CHANGED', 'Password changed', 'operator01 changed their password.'],
      ['PASSWORD_RESET_COMPLETED', 'Password reset completed', 'operator01 reset their password.'],
    ]

    for (const [action, label, summary] of events) {
      const log = { action, entityType: 'user', entityId: 'user-1', targetUser: { username: 'operator01' }, metadata: {} }

      expect(getReadableAction(log)).toBe(label)
      expect(getReadableDetails(log)).toBe(summary)
      expect(getReadableTarget(log)).toBe('operator01')
      expect(auditActionOptions.some((option) => option.value === action && option.label === label)).toBe(true)
    }
  })

  it('loads audit logs and requests the next page from the backend', async () => {
    const user = userEvent.setup()

    getAuditLogs
      .mockResolvedValueOnce({
        logs: [{ id: 'audit-1', action: 'LOGIN_SUCCESS', entityType: 'auth', createdAt: '2026-06-11T00:00:00.000Z', actor: { username: 'admin', role: 'Admin' }, metadata: {} }],
        pagination: { page: 1, limit: 25, total: 30, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
      })
      .mockResolvedValueOnce({
        logs: [{ id: 'audit-2', action: 'USER_CREATED', entityType: 'user', createdAt: '2026-06-12T00:00:00.000Z', actor: { username: 'admin', role: 'Admin' }, metadata: { targetUsername: 'operator01' } }],
        pagination: { page: 2, limit: 25, total: 30, totalPages: 2, hasNextPage: false, hasPreviousPage: true },
      })

    renderWithAuth(<AuditSection />)

    expect(await screen.findByText('Login was successful.')).toBeInTheDocument()
    expect(screen.queryByText(/admin logged in/i)).not.toBeInTheDocument()
    const refreshButton = screen.getByRole('button', { name: 'Refresh audit log' })
    expect(refreshButton).toHaveClass('reports-icon-button', 'audit-refresh-button')
    expect(refreshButton).not.toHaveTextContent('Refresh')
    expect(screen.queryByText('All dates')).not.toBeInTheDocument()
    expect(screen.queryByText('SELECTED PERIOD')).not.toBeInTheDocument()
    expect(screen.getByText('Any date')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: /audit log/i })).toBeInTheDocument()
    expect(document.querySelector('#audit-action-filter optgroup')).toBeInTheDocument()
    expect(document.querySelector('.audit-date-field .trend-calendar-trigger')).toBeInTheDocument()
    expect(document.querySelector('.audit-history-card .audit-total-chip')).toHaveTextContent('30 total')
    expect(document.querySelector('.audit-controls-actions .audit-total-chip')).not.toBeInTheDocument()
    expect(document.querySelector('.account-table-wrap .audit-pagination')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Audit pagination')).toBeInTheDocument()
    expect(screen.getByText(/showing 1–25 of 30/i)).toBeInTheDocument()

    const previousButton = screen.getByRole('button', { name: 'Previous page' })
    const nextButton = screen.getByRole('button', { name: 'Next page' })
    expect(previousButton).toHaveClass('audit-pagination-btn')
    expect(previousButton).toHaveTextContent('')
    expect(previousButton).toBeDisabled()
    expect(nextButton).toHaveClass('audit-pagination-btn')
    expect(nextButton).toHaveTextContent('')

    await user.click(nextButton)

    await waitFor(() => {
      expect(getAuditLogs).toHaveBeenLastCalledWith('test-token', expect.objectContaining({ page: 2, limit: 25 }), { signal: expect.any(AbortSignal) })
    })
    await waitFor(() => {
      expect(screen.getByText('User account created')).toBeInTheDocument()
      expect(screen.getByText('operator01 was created.')).toBeInTheDocument()
    })
  })

  it('uses a simplified table and shows readable details in a modal', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [
        {
          id: 'audit-1',
          action: 'ALERT_CREATED',
          entityType: 'sensor',
          entityId: 'sensor-1',
          createdAt: '2026-06-11T00:00:00.000Z',
          actor: null,
          metadata: {
            title: 'Outside Filler Wire downtime detected',
            sensorCode: 'S-04',
            signal: 'no_pulse',
            eventId: 'event-1',
          },
        },
      ],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)

    expect(await screen.findByRole('columnheader', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Who did it' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Source' })).not.toBeInTheDocument()
    const tableRow = (await screen.findByText(/outside filler wire downtime detected was created/i)).closest('tr')
    expect(within(tableRow).getByText('System')).toBeInTheDocument()

    const detailsButton = await screen.findByRole('button', { name: /view details/i })

    await user.click(detailsButton)

    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).queryByText('Activity summary')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('A clear summary of this activity.')).not.toBeInTheDocument()
    const detailTerms = within(dialog).getAllByRole('term')
    expect(detailTerms.map((term) => term.textContent)).toEqual([
      'What happened',
      'Who did it',
      'Time',
      'Affected item',
      'Source',
    ])
    expect(detailTerms[0].closest('.audit-detail-item')).toHaveClass('audit-detail-primary', 'audit-detail-full')
    expect(detailTerms[1].closest('.audit-detail-item')).not.toHaveClass('audit-detail-primary')
    expect(detailTerms[1].closest('.audit-detail-item')).not.toHaveClass('audit-detail-full')
    expect(detailTerms[2].closest('.audit-detail-item')).not.toHaveClass('audit-detail-full')
    expect(within(dialog).getByText('What happened')).toBeInTheDocument()
    expect(within(dialog).getByText(/outside filler wire downtime detected was created/i)).toBeInTheDocument()
    expect(within(dialog).getByText('Who did it')).toBeInTheDocument()
    expect(within(dialog).getAllByText('System')).toHaveLength(2)
    expect(within(dialog).getByText('Source')).toBeInTheDocument()
    expect(within(dialog).queryByText('Technical details')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Action code')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('event-1')).not.toBeInTheDocument()

    expect(within(dialog).queryByRole('button', { name: /close audit details/i })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Audit details' })).not.toBeInTheDocument()
  })

  it('shows manual recovery reason in readable details', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [{
        id: 'audit-override',
        action: 'SENSOR_MANUAL_RECOVERY_OVERRIDE',
        entityType: 'sensor',
        entityId: 'sensor-4',
        createdAt: '2026-08-31T01:00:00.000Z',
        actor: { username: 'admin', role: 'Admin' },
        metadata: {
          sensorCode: 'S-04',
          machineName: 'Spiral Mill 01',
          newMachineStatus: 'Running',
          reason: 'Maintenance confirmed normal operation',
        },
      }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)
    await user.click(await screen.findByRole('button', { name: /view details/i }))

    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).getByText('Override reason')).toBeInTheDocument()
    expect(within(dialog).getByText('Maintenance confirmed normal operation')).toBeInTheDocument()
    const summaryText = within(dialog).getByText(/was manually recovered/i).textContent
    expect(summaryText).not.toContain('Maintenance confirmed normal operation')
    expect(summaryText).not.toContain('..')
    expect(within(dialog).getByText('Managing Director')).toBeInTheDocument()
    expect(within(dialog).queryByText('Admin')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('admin')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Technical details')).not.toBeInTheDocument()
  })

  it('describes no-pulse sensor input as an observation instead of confirmed downtime', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [{
        id: 'audit-no-pulse',
        action: 'IOT_EVENT_RECEIVED',
        entityType: 'sensor_event',
        entityId: 'event-no-pulse',
        createdAt: '2026-09-09T07:11:08.000Z',
        actor: null,
        metadata: {
          deviceId: 'esp32-m01-s02',
          sensorCode: 'S-02',
          eventType: 'downtime',
          signal: 'no_pulse',
          watchdogObservation: true,
        },
      }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)

    expect(await screen.findByText(/reported no pulse.*observation, not confirmed downtime/i)).toBeInTheDocument()
    expect(screen.queryByText(/detected downtime/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view details/i }))
    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).getAllByText('Sensors')).toHaveLength(2)
    expect(within(dialog).getByText(/reported no pulse.*observation, not confirmed downtime/i)).toBeInTheDocument()
    expect(within(dialog).queryByText('No pulse observation (raw value: downtime)')).not.toBeInTheDocument()
  })

  it('places the icon-only clear date button beside refresh instead of under the date picker', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)

    await screen.findByText('No audit records match the selected filters.')
    expect(screen.queryByLabelText('Audit pagination')).not.toBeInTheDocument()
    const dateTrigger = screen.getByRole('button', { name: /select audit date/i })
    await user.click(dateTrigger)

    const calendarDialog = await screen.findByRole('dialog', { name: 'Select audit date' })
    const dayButton = (await within(calendarDialog).findAllByRole('button'))
      .find((button) => !button.disabled && /^\d+$/.test(button.textContent.trim()))

    await user.click(dayButton)
    expect(screen.queryByRole('button', { name: 'Clear date' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    const clearButton = await screen.findByRole('button', { name: 'Clear date' })
    expect(clearButton).toHaveClass('reports-icon-button', 'audit-date-clear')
    expect(clearButton).not.toHaveTextContent('Clear date')
    expect(document.querySelector('.audit-controls-actions .audit-date-clear')).toBe(clearButton)
    expect(document.querySelector('.audit-date-field .audit-date-clear')).not.toBeInTheDocument()

    await user.click(clearButton)
    expect(screen.queryByRole('button', { name: 'Clear date' })).not.toBeInTheDocument()
    expect(dateTrigger).toHaveFocus()
  })

  it('supports weekly audit log filtering via the calendar popover and clamps future week end to today', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)
    await screen.findByText('No audit records match the selected filters.')

    await user.click(screen.getByRole('button', { name: /select audit date/i }))
    await user.click(screen.getByRole('button', { name: 'Weekly' }))

    const weekButtons = await screen.findAllByRole('button', { name: /select week/i })
    expect(weekButtons.length).toBeGreaterThan(0)

    const enabledWeeks = weekButtons.filter((btn) => !btn.disabled)
    await user.click(enabledWeeks[enabledWeeks.length - 1])
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    const todayManila = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    await waitFor(() => {
      const lastFilters = getAuditLogs.mock.calls.at(-1)?.[1]
      expect(lastFilters).toEqual(
        expect.objectContaining({
          dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      expect(lastFilters.dateTo <= todayManila).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: 'Clear date' }))
    await user.click(screen.getByRole('button', { name: /select audit date/i }))
    expect(await screen.findByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('supports monthly audit log filtering via the calendar popover and queries with month date range', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)
    await screen.findByText('No audit records match the selected filters.')

    await user.click(screen.getByRole('button', { name: /select audit date/i }))
    await user.click(screen.getByRole('button', { name: 'Monthly' }))

    // Click Previous Year to guarantee enabled month buttons
    await user.click(screen.getByRole('button', { name: /previous year/i }))
    const enabledMonth = (await screen.findAllByRole('button', { name: /[A-Z][a-z]{2} \d{4}/ })).find((btn) => !btn.disabled)
    await user.click(enabledMonth)
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(getAuditLogs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          dateFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/),
          dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
        { signal: expect.any(AbortSignal) },
      )
    })
  })

  it('renders cold offline/error recovery state instead of false empty totals and provides a styled Retry button', async () => {
    act(() => {
      onlineManager.setOnline(false)
    })
    getAuditLogs.mockRejectedValue(new Error('Network unavailable'))

    renderWithAuth(<AuditSection />)

    expect(await screen.findByText(/audit history could not be loaded/i)).toBeInTheDocument()
    expect(screen.queryByText('No audit records match the selected filters.')).not.toBeInTheDocument()
    expect(screen.queryByText('0 total')).not.toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toHaveClass('btn-secondary')
    expect(retryButton).toBeDisabled()
  })

  it('syncs filters with URL parameters and supports one-click Reset filters and Custom range selection', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 2, limit: 25, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />, { route: '/dashboard/audit?action=LOGIN_FAILED&entity=auth&dateFrom=2026-99-99&page=2' })

    await waitFor(() => {
      expect(getAuditLogs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ action: 'LOGIN_FAILED', entityType: 'auth', date: '', page: 2 }),
        { signal: expect.any(AbortSignal) },
      )
    })

    expect(screen.getByLabelText('Activity')).toHaveValue('LOGIN_FAILED')
    expect(screen.getByLabelText('Area')).toHaveValue('auth')

    const resetButton = await screen.findByRole('button', { name: 'Reset filters' })
    await user.click(resetButton)
    expect(screen.getByLabelText('Activity')).toHaveFocus()

    await waitFor(() => {
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        'test-token',
        expect.objectContaining({ action: 'All', entityType: 'All', page: 1 }),
        { signal: expect.any(AbortSignal) },
      )
    })

    await user.click(screen.getByRole('button', { name: /select audit date/i }))
    await user.click(screen.getByRole('button', { name: 'Custom range' }))
    const days = (await within(screen.getByRole('dialog', { name: 'Select audit date' })).findAllByRole('button'))
      .filter((button) => !button.disabled && /^\d+$/.test(button.textContent.trim()))
    await user.click(days[0])
    await user.click(days[2])
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        'test-token',
        expect.objectContaining({
          dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
        { signal: expect.any(AbortSignal) },
      )
    })

    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /select audit date/i }))
    await user.click(within(screen.getByRole('dialog', { name: 'Select audit date' })).getByRole('button', { name: 'Clear' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument()
    })
  })

  it('adds mobile data-labels, closes dialog on backdrop click, and restores focus to trigger button', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [{
        id: 'audit-modal-1',
        action: 'SETTINGS_UPDATED',
        entityType: 'machine_settings',
        entityId: 'm-1',
        createdAt: '2026-06-11T00:00:00.000Z',
        actor: { username: 'admin', role: 'Admin' },
        metadata: { machineName: 'Spiral Mill 01', changedSections: ['sensorThresholds'] },
      }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)

    const detailsButton = await screen.findByRole('button', { name: /view details/i })
    const cells = detailsButton.closest('tr').querySelectorAll('td')
    expect(Array.from(cells).map((cell) => cell.getAttribute('data-label'))).toEqual([
      'Date/Time',
      'Action',
      'Who did it',
      'Affected item',
      'Summary',
      'Details',
    ])
    expect(cells[2]).toHaveTextContent('Managing Director')
    expect(cells[2]).not.toHaveTextContent('Admin')
    expect(cells[2]).not.toHaveTextContent('admin')
    expect(document.querySelector('tbody time')).toHaveAttribute('dateTime', '2026-06-11T00:00:00.000Z')
    expect(document.querySelector('.audit-action-badge')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByText('Updated sensor thresholds.')).toBeInTheDocument()

    await user.click(detailsButton)
    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(dialog).toBeInTheDocument()

    fireEvent.click(dialog)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Audit details' })).not.toBeInTheDocument()
    })
    expect(detailsButton).toHaveFocus()
    expect(detailsButton.closest('tr')).toHaveClass('audit-row-returned')
  })

  it('shows inline refresh indicator, dims placeholder results, highlights newly arrived rows, and opens details only via the button', async () => {
    const user = userEvent.setup()
    let resolveNextPage

    getAuditLogs
      .mockResolvedValueOnce({
        logs: [{
          id: 'audit-1',
          action: 'LOGIN_SUCCESS',
          entityType: 'auth',
          createdAt: '2026-06-11T00:00:00.000Z',
          actor: { username: 'admin', role: 'Admin' },
          metadata: {},
        }],
        pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      })
      .mockResolvedValueOnce({
        logs: [
          {
            id: 'audit-2',
            action: 'USER_INVITED',
            entityType: 'user',
            createdAt: '2026-06-11T01:00:00.000Z',
            actor: { username: 'admin', role: 'Admin' },
            metadata: { targetUsername: 'operator02' },
          },
          {
            id: 'audit-1',
            action: 'LOGIN_SUCCESS',
            entityType: 'auth',
            createdAt: '2026-06-11T00:00:00.000Z',
            actor: { username: 'admin', role: 'Admin' },
            metadata: {},
          },
        ],
        pagination: { page: 1, limit: 25, total: 2, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveNextPage = resolve
      }))

    renderWithAuth(<AuditSection />)

    const initialCell = await screen.findByText('Login was successful.')
    expect(initialCell.closest('tr')).not.toHaveClass('audit-row-arrived')

    await user.click(screen.getByRole('button', { name: 'Refresh audit log' }))
    const arrivedSummary = await screen.findByText(/operator02 was invited/i)
    expect(arrivedSummary.closest('tr')).toHaveClass('audit-row-arrived')

    await user.click(arrivedSummary)
    expect(screen.queryByRole('dialog', { name: 'Audit details' })).not.toBeInTheDocument()

    const rowButtons = arrivedSummary.closest('tr').querySelectorAll('.audit-details-button')
    await user.click(rowButtons[0])
    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(dialog).toBeInTheDocument()
    const filterByActionButton = within(dialog).getByRole('button', { name: 'Filter by this action' })
    expect(filterByActionButton).toHaveClass('btn-secondary', 'audit-dialog-filter-btn')
    await user.click(filterByActionButton)
    expect(screen.queryByRole('dialog', { name: 'Audit details' })).not.toBeInTheDocument()
    expect(await screen.findByText(/loading selected filters; previous results remain visible/i)).toBeInTheDocument()
    expect(document.querySelector('.audit-table tbody')).toHaveClass('is-placeholder-fetching')

    await act(async () => {
      resolveNextPage({
        logs: [],
        pagination: { page: 1, limit: 25, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      })
    })
  })

  it('disables pagination while offline and supports closing details via footer Close button', async () => {
    const user = userEvent.setup()

    getAuditLogs.mockResolvedValue({
      logs: [{
        id: 'audit-spec-1',
        action: 'PRODUCTION_SPEC_UPDATED',
        entityType: 'sensor_event',
        createdAt: '2026-06-11T00:00:00.000Z',
        actor: { username: 'admin', role: 'Admin' },
        metadata: {
          sensorCode: 'S-05',
          customer: 'MCWD',
          pipeNumber: 12,
          diameter: 300,
          thickness: 10,
          length: 6000,
          tonnage: 1.4,
        },
      }],
      pagination: { page: 1, limit: 25, total: 30, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)
    const viewButtons = await screen.findAllByRole('button', { name: 'View details' })
    await user.click(viewButtons[0])

    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).getByText('Pipe details')).toBeInTheDocument()
    expect(within(dialog).getByText(/MCWD/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Audit details' })).not.toBeInTheDocument()

    act(() => {
      onlineManager.setOnline(false)
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Refresh audit log' })).toHaveAttribute('title', 'Offline — reconnect to refresh')
    })
  })

  it('formats production calendar day, range, and removal audit entries in AuditSection', async () => {
    const user = userEvent.setup()

    const holidayWorkingLog = {
      id: 'cal-1',
      action: 'PRODUCTION_CALENDAR_DAY_SET',
      entityType: 'production_calendar',
      entityId: 'machine-1',
      createdAt: '2026-11-16T02:00:00.000Z',
      actor: { username: 'admin', role: 'Admin' },
      metadata: {
        calendarDate: '2026-12-25',
        name: 'Christmas Day',
        dayType: 'holiday',
        isWorking: true,
        reason: null,
        source: 'seeded',
        version: '2',
      },
    }

    const manualDayOffLog = {
      id: 'cal-2a',
      action: 'PRODUCTION_CALENDAR_DAY_SET',
      entityType: 'production_calendar',
      entityId: 'machine-1',
      createdAt: '2026-11-16T02:02:00.000Z',
      actor: { username: 'admin', role: 'Admin' },
      metadata: {
        calendarDate: '2026-11-19',
        name: 'Plant Inventory',
        dayType: 'day_off',
        isWorking: false,
        reason: null,
        source: 'manual',
        version: '1',
      },
    }

    const unscheduledDayLog = {
      id: 'cal-2',
      action: 'PRODUCTION_CALENDAR_DAY_SET',
      entityType: 'production_calendar',
      entityId: 'machine-1',
      createdAt: '2026-11-16T02:05:00.000Z',
      actor: { username: 'admin', role: 'Admin' },
      metadata: {
        calendarDate: '2026-11-20',
        name: 'Spiral Mill Idle',
        dayType: 'machine_not_scheduled',
        isWorking: false,
        reason: 'No orders',
        source: 'manual',
        version: '1',
      },
    }

    const shutdownRangeLog = {
      id: 'cal-3',
      action: 'PRODUCTION_CALENDAR_RANGE_SET',
      entityType: 'production_calendar',
      entityId: 'machine-1',
      createdAt: '2026-11-16T02:10:00.000Z',
      actor: { username: 'admin', role: 'Admin' },
      metadata: {
        groupId: 'group-123',
        startDate: '2026-12-23',
        endDate: '2027-01-03',
        dayCount: 12,
        name: 'Christmas Shutdown',
        dayType: 'day_off',
        isWorking: false,
        reason: null,
        confirmOverwrite: false,
        replacedDates: ['2026-12-24', '2026-12-25'],
        replacedHolidays: [
          { calendarDate: '2026-12-24', name: 'Christmas Eve', dayType: 'holiday', isWorking: false, source: 'seeded' },
          { calendarDate: '2026-12-25', name: 'Christmas Day', dayType: 'holiday', isWorking: false, source: 'seeded' },
        ],
      },
    }

    const singleRemovalLog = {
      id: 'cal-3b',
      action: 'PRODUCTION_CALENDAR_ENTRY_REMOVED',
      entityType: 'production_calendar',
      entityId: 'machine-1',
      createdAt: '2026-12-20T02:00:00.000Z',
      actor: { username: 'admin', role: 'Admin' },
      metadata: {
        mode: 'single',
        calendarDate: '2026-12-24',
        removedCount: 1,
        removedDates: ['2026-12-24'],
        lockedDates: [],
        previous: {
          name: 'Plant Cleaning',
          dayType: 'day_off',
          isWorking: false,
          reason: null,
          groupId: null,
          version: '2',
        },
        restoredDates: ['2026-12-24'],
        restoredHolidays: [
          { calendarDate: '2026-12-24', name: 'Christmas Eve', dayType: 'holiday', isWorking: false, source: 'seeded', version: 3 },
        ],
      },
    }

    const rangeRemovalLog = {
      id: 'cal-4',
      action: 'PRODUCTION_CALENDAR_ENTRY_REMOVED',
      entityType: 'production_calendar',
      entityId: 'machine-1',
      createdAt: '2026-12-29T02:00:00.000Z',
      actor: { username: 'admin', role: 'Admin' },
      metadata: {
        mode: 'range',
        groupId: 'group-123',
        name: 'Christmas Shutdown',
        dayType: 'day_off',
        reason: null,
        removedCount: 5,
        removedDates: ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'],
        lockedDates: ['2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29'],
        restoredDates: ['2026-12-30', '2026-12-31', '2027-01-01'],
        restoredHolidays: [
          { calendarDate: '2026-12-30', name: 'Rizal Day', dayType: 'holiday', isWorking: false, source: 'seeded', version: 1 },
          { calendarDate: '2026-12-31', name: 'Last Day of the Year', dayType: 'holiday', isWorking: false, source: 'seeded', version: 1 },
          { calendarDate: '2027-01-01', name: "New Year's Day", dayType: 'holiday', isWorking: false, source: 'seeded', version: 1 },
        ],
      },
    }

    expect(getReadableEntity(holidayWorkingLog)).toBe('Production Calendar')
    expect(isEntityAllowedForAction('PRODUCTION_CALENDAR_DAY_SET', 'production_calendar')).toBe(true)
    expect(isEntityAllowedForAction('PRODUCTION_CALENDAR_DAY_SET', 'auth')).toBe(false)
    expect(isEntityAllowedForAction('PRODUCTION_CALENDAR_RANGE_SET', 'production_calendar')).toBe(true)
    expect(isEntityAllowedForAction('PRODUCTION_CALENDAR_ENTRY_REMOVED', 'production_calendar')).toBe(true)

    expect(getReadableDetails(holidayWorkingLog)).toContain('Christmas Day')
    expect(getReadableDetails(holidayWorkingLog)).toContain('2026-12-25')
    expect(getReadableDetails(holidayWorkingLog)).toContain('Working')

    expect(getReadableDetails(manualDayOffLog)).toContain('Plant Inventory')
    expect(getReadableDetails(manualDayOffLog)).toContain('2026-11-19')
    expect(getReadableDetails(manualDayOffLog)).toContain('Day off')

    expect(getReadableDetails(unscheduledDayLog)).toContain('Spiral Mill Idle')
    expect(getReadableDetails(unscheduledDayLog)).toContain('2026-11-20')
    expect(getReadableDetails(unscheduledDayLog)).toContain('Machine not scheduled')
    expect(getReadableDetails(unscheduledDayLog)).toContain('No orders')

    expect(getReadableDetails(shutdownRangeLog)).toContain('Christmas Shutdown')
    expect(getReadableDetails(shutdownRangeLog)).toContain('2026-12-23')
    expect(getReadableDetails(shutdownRangeLog)).toContain('2027-01-03')
    expect(getReadableDetails(shutdownRangeLog)).toContain('Christmas Eve')

    expect(getReadableDetails(singleRemovalLog)).toContain('Plant Cleaning')
    expect(getReadableDetails(singleRemovalLog)).toContain('2026-12-24')
    expect(getReadableDetails(singleRemovalLog)).toContain('Christmas Eve')

    expect(getReadableDetails(rangeRemovalLog)).toContain('Christmas Shutdown')
    expect(getReadableDetails(rangeRemovalLog)).toContain('2026-12-30')
    expect(getReadableDetails(rangeRemovalLog)).toContain('2027-01-03')
    expect(getReadableDetails(rangeRemovalLog)).toContain('Rizal Day')

    getAuditLogs.mockResolvedValue({
      logs: [holidayWorkingLog, manualDayOffLog, unscheduledDayLog, shutdownRangeLog, singleRemovalLog, rangeRemovalLog],
      pagination: { page: 1, limit: 25, total: 6, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    })

    renderWithAuth(<AuditSection />)

    expect(await screen.findByText('Production calendar range scheduled', { selector: '.audit-action-badge' })).toBeInTheDocument()
    expect(screen.getAllByText('Production Calendar', { selector: '.audit-entity-label' })).toHaveLength(6)
    expect(screen.getAllByText('Production calendar day updated', { selector: '.audit-action-badge' })).toHaveLength(3)
    expect(screen.getAllByText('Production calendar entry removed', { selector: '.audit-action-badge' })).toHaveLength(2)

    const viewButtons = screen.getAllByRole('button', { name: 'View details' })
    await user.click(viewButtons[2])
    const dialog = screen.getByRole('dialog', { name: 'Audit details' })
    expect(within(dialog).getByText('Reason')).toBeInTheDocument()
    expect(within(dialog).getByText('No orders')).toBeInTheDocument()
  })

  it('keeps Who did it column aligned between loading skeletons and rendered rows across actor types', async () => {
    let resolveLogs
    getAuditLogs.mockImplementation(() => new Promise((resolve) => {
      resolveLogs = resolve
    }))

    renderWithAuth(<AuditSection />)

    const loadingWrap = await screen.findByLabelText('Loading audit history')
    const skeletonHeaders = within(loadingWrap).getAllByRole('columnheader')
    expect(skeletonHeaders.map((header) => header.textContent)).toEqual([
      'Date/Time',
      'Action',
      'Who did it',
      'Affected item',
      'Summary',
      'Details',
    ])
    const firstSkeletonRowCells = within(loadingWrap).getAllByRole('row')[1].querySelectorAll('td')
    expect(Array.from(firstSkeletonRowCells).map((cell) => cell.getAttribute('data-label'))).toEqual([
      'Date/Time',
      'Action',
      'Who did it',
      'Affected item',
      'Summary',
      'Details',
    ])

    await act(async () => {
      resolveLogs({
        logs: [
          {
            id: 'actor-role',
            action: 'SETTINGS_UPDATED',
            entityType: 'machine_settings',
            createdAt: '2026-06-11T00:00:00.000Z',
            actor: { username: 'admin', role: 'Admin' },
            metadata: { machineName: 'Spiral Mill 01', changedSections: ['shiftSchedule'] },
          },
          {
            id: 'actor-sensor',
            action: 'WATCHDOG_DOWNTIME_CREATED',
            entityType: 'downtime',
            createdAt: '2026-06-11T00:05:00.000Z',
            actor: null,
            metadata: { ownerSensorCode: 'S-03', sensorCode: 'S-02' },
          },
          {
            id: 'actor-auth',
            action: 'LOGIN_FAILED',
            entityType: 'auth',
            createdAt: '2026-06-11T00:10:00.000Z',
            actor: null,
            metadata: { reason: 'invalid_credentials' },
          },
        ],
        pagination: { page: 1, limit: 25, total: 3, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      })
    })

    const tableHeaders = await screen.findAllByRole('columnheader')
    expect(tableHeaders.map((header) => header.textContent)).toEqual([
      'Date/Time',
      'Action',
      'Who did it',
      'Affected item',
      'Summary',
      'Details',
    ])

    const rows = document.querySelectorAll('.audit-table tbody tr')
    expect(rows[0].querySelector('.audit-actor-cell')).toHaveTextContent('Managing Director')
    expect(rows[1].querySelector('.audit-actor-cell')).toHaveTextContent('Sensors')
    expect(rows[2].querySelector('.audit-actor-cell')).toHaveTextContent('User')
  })
})
