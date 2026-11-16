import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Calendar, ChevronDown, Lock, Plus, RotateCw, Trash2 } from 'lucide-react'
import Status from '../../../shared/components/Status.jsx'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import {
  getProductionCalendar,
  removeProductionCalendarDay,
  removeProductionCalendarRange,
  setProductionCalendarDay,
  setProductionCalendarRange,
} from './settingsService.js'
import {
  addBusinessDays,
  formatBusinessDateDisplay,
  getBackToWorkDate,
  getManilaToday,
} from './settingsUtils.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 62

function getInclusiveSpanDays(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
    return 0
  }
  const [sY, sM, sD] = startDate.split('-').map(Number)
  const [eY, eM, eD] = endDate.split('-').map(Number)
  return Math.round((Date.UTC(eY, eM - 1, eD) - Date.UTC(sY, sM - 1, sD)) / DAY_MS) + 1
}

function getDefaultEntryName(dayType, mode) {
  if (dayType === 'machine_not_scheduled') return 'Machine not scheduled'
  return mode === 'range' ? 'Plant shutdown' : 'Plant day off'
}

function getDayTypeLabel(dayType) {
  if (dayType === 'holiday') return 'Holiday'
  if (dayType === 'machine_not_scheduled') return 'Machine not scheduled'
  return 'Day off'
}

function CalendarEntriesTable({
  rows,
  ariaLabel,
  emptyMessage,
  manilaToday,
  isAdmin,
  online,
  isMutating,
  onToggleHoliday,
  onRemoveDay,
  onRemoveRange,
}) {
  if (rows.length === 0) {
    return (
      <div className="settings-breaks-empty">
        <p>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <table className="settings-break-table" aria-label={ariaLabel}>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Name & Reason</th>
          <th scope="col">Type</th>
          <th scope="col">Schedule Status</th>
          <th scope="col"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => {
          const isLocked = entry.calendarDate <= manilaToday
          const isHoliday = entry.dayType === 'holiday'
          const isRange = Boolean(entry.groupId)

          return (
            <tr key={`${entry.calendarDate}-${entry.version}`} className="settings-break-row-item">
              <td data-label="Date">
                <span className="settings-sensor-badge">{entry.calendarDate}</span>
              </td>
              <td data-label="Name & Reason">
                <div className="settings-sensor-meta">
                  <strong className="settings-sensor-title">{entry.name}</strong>
                  {entry.reason ? <span className="settings-field-hint">{entry.reason}</span> : null}
                </div>
              </td>
              <td data-label="Type">
                <span className="break-duration-pill">
                  {getDayTypeLabel(entry.dayType)}
                  {isRange ? ' · Range' : ''}
                </span>
              </td>
              <td data-label="Schedule Status">
                <Status tone={entry.isWorking ? 'active' : 'offline'}>
                  {entry.isWorking ? 'Working' : 'Day off'}
                </Status>
              </td>
              <td data-label="Action">
                <div className="settings-calendar-row-actions">
                  {isLocked ? (
                    <span className="settings-field-hint" title="Today and past dates are locked">
                      <Lock size={12} aria-hidden="true" /> Locked
                    </span>
                  ) : null}
                  {isHoliday ? (
                    <button
                      type="button"
                      className="btn btn-secondary settings-action-btn"
                      disabled={isLocked || !isAdmin || !online || isMutating}
                      aria-label={`Set ${entry.name} (${entry.calendarDate}) to ${entry.isWorking ? 'Day off' : 'Working'}`}
                      onClick={() => onToggleHoliday(entry)}
                    >
                      {entry.isWorking ? 'Set as Day off' : 'Set as Working'}
                    </button>
                  ) : isRange ? (
                    <button
                      type="button"
                      className="btn btn-secondary settings-action-btn"
                      disabled={isLocked || !isAdmin || !online || isMutating}
                      aria-label={`Remove range ${entry.name} (${entry.calendarDate})`}
                      onClick={() => onRemoveRange(entry)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      <span>Remove range</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary settings-action-btn"
                      disabled={isLocked || !isAdmin || !online || isMutating}
                      aria-label={`Remove ${entry.name} (${entry.calendarDate})`}
                      onClick={() => onRemoveDay(entry)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function ProductionCalendarPanel({ machine, restDays = [], timeZone = 'Asia/Manila' }) {
  const { token, user } = useAuth()
  const online = useNetworkOnline()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'Admin'

  const manilaToday = getManilaToday()
  const manilaTomorrow = addBusinessDays(manilaToday, 1)

  const [mode, setMode] = useState('single')
  const [dayType, setDayType] = useState('day_off')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(() => addBusinessDays(getManilaToday(), 1))
  const [endDate, setEndDate] = useState(() => addBusinessDays(getManilaToday(), 2))
  const [reason, setReason] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [panelNotice, setPanelNotice] = useState(null)
  const [isMutating, setIsMutating] = useState(false)
  const [pendingOverwrite, setPendingOverwrite] = useState(null)
  const [holidaysExpanded, setHolidaysExpanded] = useState(false)

  const calendarQuery = useAuthenticatedQuery({
    queryKey: queryKeys.settings.calendar(machine?.id || null),
    queryFn: async ({ token: currentToken, signal }) => (
      (await getProductionCalendar?.(currentToken, machine.id, undefined, signal)) ?? { entries: [] }
    ),
    enabled: Boolean(machine?.id),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  })

  const entries = useMemo(() => {
    const raw = calendarQuery.data
    if (Array.isArray(raw)) return raw
    return Array.isArray(raw?.entries) ? raw.entries : []
  }, [calendarQuery.data])

  const holidayEntries = useMemo(
    () => entries.filter((entry) => entry.dayType === 'holiday'),
    [entries],
  )
  const scheduledExclusions = useMemo(
    () => entries.filter((entry) => entry.dayType !== 'holiday'),
    [entries],
  )

  const backToWorkDate = useMemo(() => {
    if (mode === 'range') {
      if (!startDate || !endDate || endDate < startDate || getInclusiveSpanDays(startDate, endDate) > MAX_RANGE_DAYS) {
        return null
      }
      return getBackToWorkDate(endDate, restDays, entries)
    }
    return getBackToWorkDate(startDate, restDays, entries)
  }, [mode, startDate, endDate, restDays, entries])

  async function invalidateCalendarDependents() {
    if (!machine?.id) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.calendar(machine.id), refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all, refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all, refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: queryKeys.downtime.all, refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: queryKeys.overview.all, refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all, refetchType: 'active' }),
    ])
  }

  function validateForm() {
    const nextErrors = {}
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      nextErrors.startDate = 'Select a valid future date.'
    } else if (startDate <= manilaToday) {
      nextErrors.startDate = 'Calendar dates can only be scheduled in advance (starting tomorrow in Manila time).'
    }

    if (mode === 'range') {
      if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        nextErrors.endDate = 'Select a valid last day off.'
      } else if (startDate && endDate < startDate) {
        nextErrors.endDate = 'Last day off must be on or after the first day off.'
      } else if (startDate && getInclusiveSpanDays(startDate, endDate) > MAX_RANGE_DAYS) {
        nextErrors.endDate = `Shutdown range cannot exceed ${MAX_RANGE_DAYS} days.`
      }
    }

    if (dayType === 'machine_not_scheduled' && !reason.trim()) {
      nextErrors.reason = 'A reason is required when the machine is not scheduled.'
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function executeAddEntry({ targetMode, payload, confirmOverwrite = false }) {
    if (!machine?.id) return
    setIsMutating(true)
    setPanelNotice(null)
    try {
      if (targetMode === 'range') {
        await setProductionCalendarRange(token, machine.id, {
          ...payload,
          confirmOverwrite,
        })
        setPanelNotice({ type: 'success', message: 'Production calendar range saved.' })
      } else {
        const { calendarDate, ...dayBody } = payload
        await setProductionCalendarDay(token, machine.id, calendarDate, {
          ...dayBody,
          confirmOverwrite,
        })
        setPanelNotice({ type: 'success', message: 'Production calendar entry saved.' })
      }
      setPendingOverwrite(null)
      setFieldErrors({})
      setName('')
      setReason('')
      await invalidateCalendarDependents()
    } catch (error) {
      const conflictingDates = error?.details?.conflictingDates ?? error?.payload?.error?.details?.conflictingDates
      if (
        !confirmOverwrite
        && (error?.status === 409 || error?.code === 'CALENDAR_OVERWRITE_CONFIRM_REQUIRED')
        && Array.isArray(conflictingDates)
      ) {
        setPendingOverwrite({
          targetMode,
          payload,
          conflictingDates,
        })
      } else {
        setPanelNotice({
          type: 'error',
          message: error?.message || 'Unable to save production calendar entry.',
        })
      }
    } finally {
      setIsMutating(false)
    }
  }

  function handleAddEntry() {
    if (!validateForm() || isMutating || !isAdmin || !online) return
    const resolvedName = name.trim() || getDefaultEntryName(dayType, mode)
    const resolvedReason = reason.trim() ? reason.trim() : null

    if (mode === 'range') {
      void executeAddEntry({
        targetMode: 'range',
        payload: {
          startDate,
          endDate,
          dayType,
          name: resolvedName,
          reason: resolvedReason,
        },
      })
    } else {
      void executeAddEntry({
        targetMode: 'single',
        payload: {
          calendarDate: startDate,
          dayType,
          name: resolvedName,
          isWorking: false,
          reason: resolvedReason,
        },
      })
    }
  }

  async function handleToggleHoliday(entry) {
    if (!machine?.id || isMutating || !isAdmin || !online || entry.calendarDate <= manilaToday) return
    setIsMutating(true)
    setPanelNotice(null)
    try {
      await setProductionCalendarDay(token, machine.id, entry.calendarDate, {
        dayType: 'holiday',
        name: entry.name,
        isWorking: !entry.isWorking,
        expectedVersion: entry.version,
      })
      setPanelNotice({
        type: 'success',
        message: `${entry.name} (${entry.calendarDate}) set to ${!entry.isWorking ? 'Working' : 'Day off'}.`,
      })
      await invalidateCalendarDependents()
    } catch (error) {
      setPanelNotice({
        type: 'error',
        message: error?.message || 'Unable to update holiday status.',
      })
    } finally {
      setIsMutating(false)
    }
  }

  async function handleRemoveDay(entry) {
    if (!machine?.id || isMutating || !isAdmin || !online || entry.calendarDate <= manilaToday) return
    setIsMutating(true)
    setPanelNotice(null)
    try {
      const response = await removeProductionCalendarDay(token, machine.id, entry.calendarDate)
      const result = response?.result ?? response
      if (result?.restoredHolidays?.length > 0) {
        setPanelNotice({
          type: 'success',
          message: `Removed override for ${entry.calendarDate} and restored seeded holiday (${result.restoredHolidays[0].name}).`,
        })
      } else {
        setPanelNotice({ type: 'success', message: `Removed calendar entry for ${entry.calendarDate}.` })
      }
      await invalidateCalendarDependents()
    } catch (error) {
      setPanelNotice({
        type: 'error',
        message: error?.message || 'Unable to remove calendar entry.',
      })
    } finally {
      setIsMutating(false)
    }
  }

  async function handleRemoveRange(entry) {
    if (!machine?.id || isMutating || !isAdmin || !online || !entry.groupId || entry.calendarDate <= manilaToday) return
    setIsMutating(true)
    setPanelNotice(null)
    try {
      const response = await removeProductionCalendarRange(token, machine.id, entry.groupId)
      const result = response?.result ?? response
      if (result?.lockedDates?.length > 0) {
        setPanelNotice({
          type: 'success',
          message: `Only remaining future dates were removed (${result.removedCount} removed, ${result.lockedDates.length} elapsed or current date(s) locked).`,
        })
      } else {
        setPanelNotice({
          type: 'success',
          message: `Removed shutdown range (${result?.removedCount ?? 0} future date(s) cleared).`,
        })
      }
      await invalidateCalendarDependents()
    } catch (error) {
      setPanelNotice({
        type: 'error',
        message: error?.message || 'Unable to remove production calendar range.',
      })
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <section className="section-card settings-panel settings-calendar-panel" aria-labelledby="production-calendar-title">
      <div className="section-heading">
        <div className="section-copy">
          <div className="settings-shift-title">
            <h2 id="production-calendar-title">Production Calendar</h2>
            <span className="settings-timezone">{timeZone}</span>
          </div>
        </div>
        <span className="shift-duration-badge">Advance edits only</span>
      </div>

      <p className="settings-field-hint">
        Dated holidays, plant closures, and machine-unscheduled days override weekly rest days and shift hours starting tomorrow ({manilaTomorrow}).
      </p>

      {panelNotice ? (
        <div
          className={`notice notice-${panelNotice.type} dashboard-alert`}
          role={panelNotice.type === 'error' ? 'alert' : 'status'}
        >
          {panelNotice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : null}
          <span>{panelNotice.message}</span>
        </div>
      ) : null}

      {pendingOverwrite ? (
        <div className="notice notice-error dashboard-alert settings-overwrite-dialog" role="alertdialog" aria-labelledby="calendar-overwrite-title">
          <AlertTriangle size={16} aria-hidden="true" />
          <div className="settings-overwrite-body">
            <strong id="calendar-overwrite-title">Overwrite existing manual calendar entries?</strong>
            <p className="settings-field-hint">
              Manual entries already exist on: {pendingOverwrite.conflictingDates.join(', ')}. Confirming will replace them.
            </p>
            <div className="settings-overwrite-actions">
              <button
                type="button"
                className="btn btn-primary settings-action-btn"
                disabled={isMutating}
                onClick={() => void executeAddEntry({ ...pendingOverwrite, confirmOverwrite: true })}
              >
                Confirm overwrite
              </button>
              <button
                type="button"
                className="btn btn-secondary settings-action-btn"
                disabled={isMutating}
                onClick={() => setPendingOverwrite(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="settings-work-bar settings-calendar-builder">
        <div className="break-matrix-header">
          <strong>Schedule future day off or unscheduled stop</strong>
          <div className="settings-calendar-mode-group" role="radiogroup" aria-label="Calendar span mode">
            <label className={`settings-rest-day-pill ${mode === 'single' ? 'is-selected' : ''}`.trim()}>
              <input
                type="radio"
                name="calendar-span-mode"
                value="single"
                checked={mode === 'single'}
                disabled={!isAdmin || !online || isMutating}
                onChange={() => {
                  setMode('single')
                  setPendingOverwrite(null)
                  setFieldErrors({})
                }}
              />
              <span>Single day</span>
            </label>
            <label className={`settings-rest-day-pill ${mode === 'range' ? 'is-selected' : ''}`.trim()}>
              <input
                type="radio"
                name="calendar-span-mode"
                value="range"
                checked={mode === 'range'}
                disabled={!isAdmin || !online || isMutating}
                onChange={() => {
                  setMode('range')
                  setPendingOverwrite(null)
                  setFieldErrors({})
                }}
              />
              <span>Date range</span>
            </label>
          </div>
        </div>

        <div className="settings-work-grid settings-calendar-grid">
          <label className="settings-field-group">
            <span className="field-label-text">Exclusion type</span>
            <select
              aria-label="Exclusion type"
              className="settings-text-input"
              disabled={!isAdmin || !online || isMutating}
              value={dayType}
              onChange={(event) => {
                setDayType(event.target.value)
                setPendingOverwrite(null)
                setFieldErrors((current) => ({ ...current, reason: undefined }))
              }}
            >
              <option value="day_off">Day off (plant closure)</option>
              <option value="machine_not_scheduled">Machine not scheduled</option>
            </select>
          </label>

          {mode === 'single' ? (
            <label className="settings-field-group">
              <span className="field-label-text">Exclusion date</span>
              <input
                aria-label="Exclusion date"
                aria-invalid={fieldErrors.startDate ? 'true' : undefined}
                aria-describedby={fieldErrors.startDate ? 'calendar-start-date-error' : undefined}
                type="date"
                className="settings-time-input"
                min={manilaTomorrow}
                disabled={!isAdmin || !online || isMutating}
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value)
                  setPendingOverwrite(null)
                  setFieldErrors((current) => ({ ...current, startDate: undefined }))
                }}
              />
              {fieldErrors.startDate ? <p id="calendar-start-date-error" className="field-error">{fieldErrors.startDate}</p> : null}
            </label>
          ) : (
            <>
              <label className="settings-field-group">
                <span className="field-label-text">First day off</span>
                <input
                  aria-label="First day off"
                  aria-invalid={fieldErrors.startDate ? 'true' : undefined}
                  aria-describedby={fieldErrors.startDate ? 'calendar-start-date-error' : undefined}
                  type="date"
                  className="settings-time-input"
                  min={manilaTomorrow}
                  disabled={!isAdmin || !online || isMutating}
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value)
                    setPendingOverwrite(null)
                    setFieldErrors((current) => ({ ...current, startDate: undefined }))
                  }}
                />
                {fieldErrors.startDate ? <p id="calendar-start-date-error" className="field-error">{fieldErrors.startDate}</p> : null}
              </label>

              <label className="settings-field-group">
                <span className="field-label-text">Last day off</span>
                <input
                  aria-label="Last day off"
                  aria-invalid={fieldErrors.endDate ? 'true' : undefined}
                  aria-describedby={fieldErrors.endDate ? 'calendar-end-date-error' : undefined}
                  type="date"
                  className="settings-time-input"
                  min={startDate || manilaTomorrow}
                  disabled={!isAdmin || !online || isMutating}
                  value={endDate}
                  onChange={(event) => {
                    setEndDate(event.target.value)
                    setPendingOverwrite(null)
                    setFieldErrors((current) => ({ ...current, endDate: undefined }))
                  }}
                />
                {fieldErrors.endDate ? <p id="calendar-end-date-error" className="field-error">{fieldErrors.endDate}</p> : null}
              </label>
            </>
          )}

          <label className="settings-field-group">
            <span className="field-label-text">Label (optional)</span>
            <input
              aria-label="Entry name"
              type="text"
              className="settings-text-input"
              maxLength={150}
              placeholder={getDefaultEntryName(dayType, mode)}
              disabled={!isAdmin || !online || isMutating}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setPendingOverwrite(null)
              }}
            />
          </label>

          {dayType === 'machine_not_scheduled' ? (
            <label className="settings-field-group">
              <span className="field-label-text">Reason (required)</span>
              <input
                aria-label="Reason"
                aria-invalid={fieldErrors.reason ? 'true' : undefined}
                aria-describedby={fieldErrors.reason ? 'calendar-reason-error' : undefined}
                type="text"
                className="settings-text-input"
                maxLength={500}
                placeholder="e.g. No orders, Planned maintenance"
                disabled={!isAdmin || !online || isMutating}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  setPendingOverwrite(null)
                  setFieldErrors((current) => ({ ...current, reason: undefined }))
                }}
              />
              {fieldErrors.reason ? <p id="calendar-reason-error" className="field-error">{fieldErrors.reason}</p> : null}
            </label>
          ) : null}
        </div>

        <div className="break-matrix-header settings-calendar-footer">
          <div className="settings-calendar-preview">
            <Calendar size={14} aria-hidden="true" />
            <span>
              {backToWorkDate
                ? `Back to work: ${formatBusinessDateDisplay(backToWorkDate)}`
                : 'Select valid dates to preview return workday'}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary settings-add-break"
            disabled={!isAdmin || !online || isMutating}
            onClick={handleAddEntry}
          >
            {isMutating ? <RotateCw size={14} className="spin-icon" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
            <span>Add to calendar</span>
          </button>
        </div>
      </div>

      {calendarQuery.isError ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{calendarQuery.error?.message || 'Unable to load production calendar.'}</span>
        </div>
      ) : (
        <>
          <div className="settings-break-matrix-wrap">
            <div className="break-matrix-header">
              <div className="break-matrix-title">
                <strong>Scheduled Exclusions</strong>
                <span className="break-count-pill">{scheduledExclusions.length}</span>
              </div>
            </div>

            <div className="settings-break-table-container">
              <CalendarEntriesTable
                rows={scheduledExclusions}
                ariaLabel="Scheduled production calendar exclusions"
                emptyMessage="No custom days off or shutdown ranges scheduled."
                manilaToday={manilaToday}
                isAdmin={isAdmin}
                online={online}
                isMutating={isMutating}
                onToggleHoliday={(entry) => void handleToggleHoliday(entry)}
                onRemoveDay={(entry) => void handleRemoveDay(entry)}
                onRemoveRange={(entry) => void handleRemoveRange(entry)}
              />
            </div>
          </div>

          <div className="settings-break-matrix-wrap settings-holidays-section">
            <div className="break-matrix-header">
              <div className="break-matrix-title">
                <strong>Holidays</strong>
                <span className="break-count-pill">{holidayEntries.length}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary settings-holiday-toggle-btn"
                aria-expanded={holidaysExpanded}
                aria-controls={holidaysExpanded ? 'production-calendar-holidays-panel' : undefined}
                onClick={() => setHolidaysExpanded((current) => !current)}
              >
                <span>{holidaysExpanded ? 'Hide holidays' : 'Show holidays'}</span>
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={`settings-holiday-chevron ${holidaysExpanded ? 'is-open' : ''}`.trim()}
                />
              </button>
            </div>

            {holidaysExpanded ? (
              <div id="production-calendar-holidays-panel" className="settings-break-table-container">
                <CalendarEntriesTable
                  rows={holidayEntries}
                  ariaLabel="Production calendar holidays"
                  emptyMessage="No holidays configured."
                  manilaToday={manilaToday}
                  isAdmin={isAdmin}
                  online={online}
                  isMutating={isMutating}
                  onToggleHoliday={(entry) => void handleToggleHoliday(entry)}
                  onRemoveDay={(entry) => void handleRemoveDay(entry)}
                  onRemoveRange={(entry) => void handleRemoveRange(entry)}
                />
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
