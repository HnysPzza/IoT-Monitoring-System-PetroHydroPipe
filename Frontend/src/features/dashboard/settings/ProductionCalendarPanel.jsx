import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Lock,
  Plus,
  RotateCw,
  Undo2,
  X,
} from 'lucide-react'
import Status from '../../../shared/components/Status.jsx'
import { AnimatedTrashButton } from '../../../shared/components/AnimatedTrashButton.jsx'
import { Calendar } from '../../../shared/components/ui/Calendar.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import '../../../shared/components/ui/calendar.css'
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
  WEEKDAYS,
  addBusinessDays,
  formatBusinessDateDisplay,
  getBackToWorkDate,
  getManilaToday,
  groupCalendarEntries,
  normalizeRestDays,
} from './settingsUtils.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 62
const CALENDAR_REMOVE_UNDO_MS = 7000
const CALENDAR_EDIT_ROLES = new Set(['Admin', 'Engineering Supervisor'])

export function SettingsInfoButton({ label, content }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="settings-info-trigger"
          aria-label={label}
          title={label}
        >
          <HelpCircle size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="settings-info-popover"
        align="start"
        sideOffset={6}
        aria-label={label}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}

function getInclusiveSpanDays(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
    return 0
  }
  const [sY, sM, sD] = startDate.split('-').map(Number)
  const [eY, eM, eD] = endDate.split('-').map(Number)
  return Math.round((Date.UTC(eY, eM - 1, eD) - Date.UTC(sY, sM - 1, sD)) / DAY_MS) + 1
}

function parseIsoDateLocal(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return undefined
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatIsoDateLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

function formatRowDateText(row) {
  if (!row.isRangeGroup) {
    return formatBusinessDateDisplay(row.startDate) || row.startDate
  }
  const startLabel = formatBusinessDateDisplay(row.startDate) || row.startDate
  const endLabel = formatBusinessDateDisplay(row.endDate) || row.endDate
  return `${startLabel} – ${endLabel} (${row.dayCount}d)`
}

function CalendarEntriesTable({
  rows,
  ariaLabel,
  emptyMessage,
  canEditCalendar,
  online,
  isMutating,
  mutatingKey,
  onToggleHoliday,
  onRequestRemove,
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
          <th scope="col">Entry</th>
          <th scope="col">Type</th>
          <th scope="col">Status</th>
          <th scope="col"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isHoliday = row.dayType === 'holiday'
          const isBusyRow = isMutating && mutatingKey === row.key
          const isUnavailable = row.isAllLocked || !canEditCalendar || !online

          return (
            <tr key={row.key} className="settings-break-row-item">
              <td data-label="Date">
                <span className="settings-calendar-date-text">{formatRowDateText(row)}</span>
              </td>
              <td data-label="Entry">
                <div className="settings-sensor-meta">
                  <strong className="settings-sensor-title">{row.name}</strong>
                  {row.reason ? <span className="settings-calendar-submeta">{row.reason}</span> : null}
                </div>
              </td>
              <td data-label="Type">
                <span className="settings-calendar-submeta">
                  {getDayTypeLabel(row.dayType)}
                  {row.isRangeGroup ? ' · Range' : ''}
                </span>
              </td>
              <td data-label="Status">
                <Status tone={row.isWorking ? 'active' : 'offline'}>
                  {row.isWorking ? 'Working' : 'Day off'}
                </Status>
              </td>
              <td data-label="Action">
                <div className="settings-calendar-row-actions">
                  {row.isAllLocked ? (
                    <span className="settings-locked-tag" title="Today and past dates are locked">
                      <Lock size={12} aria-hidden="true" /> Locked
                    </span>
                  ) : null}
                  {isHoliday && row.entry ? (
                    <button
                      type="button"
                      className="btn btn-ghost settings-action-btn"
                      disabled={isUnavailable}
                      aria-disabled={isMutating ? 'true' : undefined}
                      aria-busy={isBusyRow ? 'true' : undefined}
                      aria-label={`Set ${row.entry.name} (${row.entry.calendarDate}) to ${row.entry.isWorking ? 'Day off' : 'Working'}`}
                      onClick={() => {
                        if (!isMutating) onToggleHoliday(row.entry, row.key)
                      }}
                    >
                      {isBusyRow ? 'Saving…' : row.entry.isWorking ? 'Set as Day off' : 'Set as Working'}
                    </button>
                  ) : (
                    <AnimatedTrashButton
                      title={row.isRangeGroup ? `Remove range ${row.name}` : `Remove ${row.name}`}
                      ariaLabel={
                        row.isRangeGroup
                          ? `Remove range ${row.name} (${row.startDate} to ${row.endDate})`
                          : `Remove ${row.name} (${row.startDate})`
                      }
                      disabled={isUnavailable || isMutating}
                      onClick={(event) => onRequestRemove(row, event)}
                    />
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

function getRemovalOutcomeMessage(target, response) {
  const result = response?.result ?? response
  if (target.isRangeGroup && target.groupId) {
    if (result?.lockedDates?.length > 0) {
      return `Only remaining future dates were removed (${result.removedCount} removed, ${result.lockedDates.length} elapsed or current date(s) locked).`
    }
    return `Removed shutdown range (${result?.removedCount ?? 0} future date(s) cleared).`
  }
  if (result?.restoredHolidays?.length > 0) {
    return `Removed override for ${target.startDate} and restored seeded holiday (${result.restoredHolidays[0].name}).`
  }
  return `Removed calendar entry for ${target.startDate}.`
}

export default function ProductionCalendarPanel({
  machine,
  restDays = [],
  persistedRestDaysDirty = false,
  timeZone = 'Asia/Manila',
}) {
  const { token, user } = useAuth()
  const online = useNetworkOnline()
  const queryClient = useQueryClient()
  const canEditCalendar = CALENDAR_EDIT_ROLES.has(user?.role)

  const manilaToday = getManilaToday()
  const manilaTomorrow = addBusinessDays(manilaToday, 1)

  const scheduleDialogRef = useRef(null)
  const confirmDialogRef = useRef(null)
  const scheduleTriggerRef = useRef(null)
  const confirmCancelRef = useRef(null)
  const removeTriggerRef = useRef(null)
  const undoButtonRef = useRef(null)
  const pendingRemovalRef = useRef(null)
  const undoTimerRef = useRef(null)
  const snackbarNoticeTimerRef = useRef(null)

  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [mode, setMode] = useState('single')
  const [dayType, setDayType] = useState('day_off')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(() => addBusinessDays(getManilaToday(), 1))
  const [endDate, setEndDate] = useState(() => addBusinessDays(getManilaToday(), 2))
  const [reason, setReason] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [panelNotice, setPanelNotice] = useState(null)
  const [snackbarNotice, setSnackbarNotice] = useState(null)
  const [isMutating, setIsMutating] = useState(false)
  const [mutatingKey, setMutatingKey] = useState(null)
  const [pendingOverwrite, setPendingOverwrite] = useState(null)
  const [pendingRemove, setPendingRemove] = useState(null)
  const [pendingRemoval, setPendingRemoval] = useState(null)
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

  const visibleEntries = useMemo(() => {
    if (!pendingRemoval) return entries
    return entries.filter((entry) => !pendingRemoval.dates.has(entry.calendarDate))
  }, [entries, pendingRemoval])

  const holidayEntries = useMemo(
    () => visibleEntries.filter((entry) => entry.dayType === 'holiday'),
    [visibleEntries],
  )
  const scheduledExclusions = useMemo(
    () => visibleEntries.filter((entry) => entry.dayType !== 'holiday'),
    [visibleEntries],
  )

  const groupedExclusions = useMemo(
    () => groupCalendarEntries(scheduledExclusions, manilaToday),
    [scheduledExclusions, manilaToday],
  )
  const holidayRows = useMemo(
    () => groupCalendarEntries(holidayEntries, manilaToday),
    [holidayEntries, manilaToday],
  )

  const normalizedRestDays = useMemo(() => new Set(normalizeRestDays(restDays)), [restDays])
  const holidayDateSet = useMemo(
    () => new Set(holidayEntries.map((item) => item.calendarDate)),
    [holidayEntries],
  )
  const exclusionDateSet = useMemo(
    () => new Set(scheduledExclusions.map((item) => item.calendarDate)),
    [scheduledExclusions],
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

  useEffect(() => {
    const dialog = scheduleDialogRef.current
    if (!dialog) return
    if (isScheduleOpen && !dialog.hasAttribute('open')) {
      dialog.showModal?.()
    } else if (!isScheduleOpen && dialog.hasAttribute('open')) {
      dialog.close?.()
    }
  }, [isScheduleOpen])

  useEffect(() => {
    const dialog = confirmDialogRef.current
    if (!dialog) return
    if (pendingRemove && !dialog.hasAttribute('open')) {
      dialog.showModal?.()
      confirmCancelRef.current?.focus({ preventScroll: true })
    } else if (!pendingRemove && dialog.hasAttribute('open')) {
      dialog.close?.()
    }
  }, [pendingRemove])

  useEffect(() => () => {
    window.clearTimeout(undoTimerRef.current)
    window.clearTimeout(snackbarNoticeTimerRef.current)
  }, [])

  useEffect(() => {
    if (!snackbarNotice) return undefined
    snackbarNoticeTimerRef.current = window.setTimeout(() => setSnackbarNotice(null), 5000)
    return () => window.clearTimeout(snackbarNoticeTimerRef.current)
  }, [snackbarNotice])

  useEffect(() => {
    if (pendingRemoval?.phase === 'undo') {
      undoButtonRef.current?.focus({ preventScroll: true })
    }
  }, [pendingRemoval])

  function openScheduleModal(event) {
    if (!canEditCalendar || !online || isMutating || pendingRemovalRef.current) return
    scheduleTriggerRef.current = event?.currentTarget || null
    setFieldErrors({})
    setPendingOverwrite(null)
    setPanelNotice(null)
    setIsScheduleOpen(true)
  }

  function closeScheduleModal() {
    if (isMutating) return
    setPendingOverwrite(null)
    setFieldErrors({})
    setIsScheduleOpen(false)
    if (scheduleTriggerRef.current?.isConnected) {
      scheduleTriggerRef.current.focus({ preventScroll: true })
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setPendingOverwrite(null)
    setFieldErrors({})
    if (nextMode === 'range' && startDate && (!endDate || endDate < startDate)) {
      setEndDate(startDate)
    }
  }

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
      setIsScheduleOpen(false)
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
    if (!validateForm() || isMutating || !canEditCalendar || !online) return
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

  async function handleToggleHoliday(entry, rowKey) {
    if (!machine?.id || isMutating || pendingRemovalRef.current || !canEditCalendar || !online || entry.calendarDate <= manilaToday) return
    setIsMutating(true)
    setMutatingKey(rowKey)
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
      setMutatingKey(null)
    }
  }

  function confirmPendingRemove() {
    if (!pendingRemove || !machine?.id || pendingRemovalRef.current || isMutating || !canEditCalendar || !online) return
    const target = pendingRemove
    const pending = {
      target,
      dates: new Set(target.entries.map((entry) => entry.calendarDate)),
      phase: 'undo',
    }
    pendingRemovalRef.current = pending
    setPendingRemove(null)
    setPendingRemoval(pending)
    setPanelNotice(null)
    setSnackbarNotice(null)
    window.clearTimeout(snackbarNoticeTimerRef.current)

    undoTimerRef.current = window.setTimeout(async () => {
      undoTimerRef.current = null
      if (pendingRemovalRef.current !== pending) return

      const committing = { ...pending, phase: 'saving' }
      pendingRemovalRef.current = committing
      setPendingRemoval(committing)

      let nextNotice
      try {
        const response = target.isRangeGroup && target.groupId
          ? await removeProductionCalendarRange(token, machine.id, target.groupId)
          : await removeProductionCalendarDay(token, machine.id, target.startDate)
        nextNotice = { type: 'success', message: getRemovalOutcomeMessage(target, response) }
      } catch (error) {
        nextNotice = {
          type: 'error',
          message: error?.message || 'Unable to remove calendar entry.',
        }
      } finally {
        if (pendingRemovalRef.current === committing) pendingRemovalRef.current = null
        setPendingRemoval(null)
        setSnackbarNotice(nextNotice)
        void invalidateCalendarDependents()
      }
    }, CALENDAR_REMOVE_UNDO_MS)
  }

  function undoPendingRemoval() {
    if (pendingRemovalRef.current?.phase !== 'undo') return
    window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
    pendingRemovalRef.current = null
    setPendingRemoval(null)
  }

  const tomorrowDateObj = useMemo(() => parseIsoDateLocal(manilaTomorrow), [manilaTomorrow])
  const maxYear = Number((manilaToday || '2026').slice(0, 4)) + 2
  const calendarSelected = useMemo(() => {
    if (mode === 'range') {
      const from = parseIsoDateLocal(startDate)
      const to = parseIsoDateLocal(endDate)
      return from ? { from, to } : undefined
    }
    return parseIsoDateLocal(startDate)
  }, [mode, startDate, endDate])

  function handleCalendarSelect(selection) {
    setPendingOverwrite(null)
    if (mode === 'single') {
      const nextKey = formatIsoDateLocal(selection)
      if (!nextKey) return
      setStartDate(nextKey)
      setFieldErrors((current) => ({ ...current, startDate: undefined }))
      return
    }
    const nextStart = formatIsoDateLocal(selection?.from)
    const nextEnd = formatIsoDateLocal(selection?.to || selection?.from)
    if (nextStart) setStartDate(nextStart)
    if (nextEnd) setEndDate(nextEnd)
    setFieldErrors((current) => ({ ...current, startDate: undefined, endDate: undefined }))
  }

  function closeConfirmRemove(restoreFocus = false) {
    if (isMutating) return
    setPendingRemove(null)
    if (restoreFocus && removeTriggerRef.current?.isConnected) {
      removeTriggerRef.current.focus({ preventScroll: true })
    }
  }

  function requestRemoveRow(row, event) {
    if (pendingRemovalRef.current || isMutating) return
    removeTriggerRef.current = event?.currentTarget || null
    setPendingRemove(row)
  }

  return (
    <section className="section-card settings-panel settings-calendar-panel" aria-labelledby="production-calendar-title">
      <div className="section-heading">
        <div className="section-copy">
          <div className="settings-heading-with-info">
            <h2 id="production-calendar-title">Production Calendar</h2>
            <SettingsInfoButton
              label="Production calendar rules information"
              content={`Dated holidays, plant closures, and unscheduled stops override weekly rest days starting tomorrow (${manilaTomorrow}, ${timeZone}).`}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-outline settings-action-btn"
          disabled={!canEditCalendar || !online || isMutating || Boolean(pendingRemoval)}
          title={!canEditCalendar ? 'Engineering Supervisor or Admin role required to edit calendar' : undefined}
          onClick={openScheduleModal}
        >
          <Plus size={14} aria-hidden="true" />
          <span>Schedule exception</span>
        </button>
      </div>

      {panelNotice ? (
        <div
          className={`notice notice-${panelNotice.type} dashboard-alert`}
          role={panelNotice.type === 'error' ? 'alert' : 'status'}
        >
          {panelNotice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : null}
          <span>{panelNotice.message}</span>
        </div>
      ) : null}

      {calendarQuery.isPending ? (
        <div className="settings-skeleton-table" aria-busy="true" aria-label="Loading production calendar">
          <div className="skeleton settings-skeleton-row" />
          <div className="skeleton settings-skeleton-row" />
        </div>
      ) : calendarQuery.isError ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{calendarQuery.error?.message || 'Unable to load production calendar.'}</span>
          <button
            type="button"
            className="btn btn-outline settings-inline-retry-btn"
            onClick={() => void calendarQuery.refetch()}
          >
            <RotateCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : (
        <>
          <div className="settings-break-matrix-wrap">
            <div className="break-matrix-header">
              <div className="break-matrix-title">
                <h3>
                  Scheduled exclusions{' '}
                  <span className="settings-inline-count">({groupedExclusions.length})</span>
                </h3>
              </div>
            </div>

            <div className="settings-break-table-container">
              <CalendarEntriesTable
                rows={groupedExclusions}
                ariaLabel="Scheduled production calendar exclusions"
                emptyMessage="No custom days off or shutdown ranges scheduled."
                canEditCalendar={canEditCalendar}
                online={online}
                isMutating={isMutating || Boolean(pendingRemoval)}
                mutatingKey={mutatingKey}
                onToggleHoliday={(entry, key) => void handleToggleHoliday(entry, key)}
                onRequestRemove={requestRemoveRow}
              />
            </div>
          </div>

          <div className="settings-holidays-section">
            <div className="break-matrix-header settings-holidays-header">
              <h3>
                Holidays{' '}
                <span className="settings-inline-count">({holidayRows.length})</span>
              </h3>
              <button
                type="button"
                className="btn btn-ghost settings-holiday-toggle-btn"
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
                  rows={holidayRows}
                  ariaLabel="Production calendar holidays"
                  emptyMessage="No holidays configured."
                  canEditCalendar={canEditCalendar}
                  online={online}
                  isMutating={isMutating || Boolean(pendingRemoval)}
                  mutatingKey={mutatingKey}
                  onToggleHoliday={(entry, key) => void handleToggleHoliday(entry, key)}
                  onRequestRemove={requestRemoveRow}
                />
              </div>
            ) : null}
          </div>
        </>
      )}

      <dialog
        ref={scheduleDialogRef}
        className="settings-calendar-dialog"
        aria-labelledby="schedule-exception-title"
        onCancel={(event) => {
          if (isMutating) {
            event.preventDefault()
          } else {
            closeScheduleModal()
          }
        }}
        onClose={() => {
          setIsScheduleOpen(false)
          setPendingOverwrite(null)
          setFieldErrors({})
        }}
      >
        {isScheduleOpen ? (
          <>
            <div className="settings-dialog-header">
              <h3 id="schedule-exception-title">Schedule exception</h3>
              <button
                type="button"
                className="btn btn-ghost settings-dialog-close-btn"
                aria-label="Close schedule exception dialog"
                disabled={isMutating}
                onClick={closeScheduleModal}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="settings-dialog-body">
              {persistedRestDaysDirty ? (
                <p className="settings-field-hint">
                  Using saved weekly rest days for Back to work preview until Shift changes are saved.
                </p>
              ) : null}

              {pendingOverwrite ? (
                <div
                  className="notice notice-error dashboard-alert settings-overwrite-dialog"
                  role="alertdialog"
                  aria-labelledby="calendar-overwrite-title"
                >
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
                        className="btn btn-ghost settings-action-btn"
                        disabled={isMutating}
                        onClick={() => setPendingOverwrite(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="settings-dialog-grid">
                <div className="settings-dialog-fields">
                  <div className="settings-segmented-control" role="radiogroup" aria-label="Calendar span mode">
                    <label className={`settings-segmented-tab ${mode === 'single' ? 'is-selected' : ''}`.trim()}>
                      <input
                        type="radio"
                        className="sr-only"
                        name="calendar-span-mode"
                        value="single"
                        checked={mode === 'single'}
                        disabled={!canEditCalendar || !online || isMutating}
                        onChange={() => switchMode('single')}
                      />
                      <span>Single day</span>
                    </label>
                    <label className={`settings-segmented-tab ${mode === 'range' ? 'is-selected' : ''}`.trim()}>
                      <input
                        type="radio"
                        className="sr-only"
                        name="calendar-span-mode"
                        value="range"
                        checked={mode === 'range'}
                        disabled={!canEditCalendar || !online || isMutating}
                        onChange={() => switchMode('range')}
                      />
                      <span>Date range</span>
                    </label>
                  </div>

                  <div className="settings-field-col">
                    <label htmlFor="calendar-day-type" className="field-label-text">Exclusion type</label>
                    <div className="custom-select-wrap">
                      <select
                        id="calendar-day-type"
                        aria-label="Exclusion type"
                        disabled={!canEditCalendar || !online || isMutating}
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
                      <ChevronDown className="select-chevron-icon" size={15} aria-hidden="true" />
                    </div>
                  </div>

                  {mode === 'single' ? (
                    <div className="settings-field-col">
                      <label htmlFor="calendar-start-date" className="field-label-text">Exclusion date</label>
                      <input
                        id="calendar-start-date"
                        aria-label="Exclusion date"
                        aria-invalid={fieldErrors.startDate ? 'true' : undefined}
                        aria-describedby={fieldErrors.startDate ? 'calendar-start-date-error' : undefined}
                        type="date"
                        className="settings-time-input"
                        min={manilaTomorrow}
                        disabled={!canEditCalendar || !online || isMutating}
                        value={startDate}
                        onChange={(event) => {
                          setStartDate(event.target.value)
                          setPendingOverwrite(null)
                          setFieldErrors((current) => ({ ...current, startDate: undefined }))
                        }}
                      />
                      {fieldErrors.startDate ? <p id="calendar-start-date-error" className="field-error">{fieldErrors.startDate}</p> : null}
                    </div>
                  ) : (
                    <div className="settings-dialog-date-pair">
                      <div className="settings-field-col">
                        <label htmlFor="calendar-range-start" className="field-label-text">First day off</label>
                        <input
                          id="calendar-range-start"
                          aria-label="First day off"
                          aria-invalid={fieldErrors.startDate ? 'true' : undefined}
                          aria-describedby={fieldErrors.startDate ? 'calendar-start-date-error' : undefined}
                          type="date"
                          className="settings-time-input"
                          min={manilaTomorrow}
                          disabled={!canEditCalendar || !online || isMutating}
                          value={startDate}
                          onChange={(event) => {
                            const nextVal = event.target.value
                            setStartDate(nextVal)
                            if (endDate && nextVal && endDate < nextVal) {
                              setEndDate(nextVal)
                            }
                            setPendingOverwrite(null)
                            setFieldErrors((current) => ({ ...current, startDate: undefined, endDate: undefined }))
                          }}
                        />
                        {fieldErrors.startDate ? <p id="calendar-start-date-error" className="field-error">{fieldErrors.startDate}</p> : null}
                      </div>

                      <div className="settings-field-col">
                        <label htmlFor="calendar-range-end" className="field-label-text">Last day off</label>
                        <input
                          id="calendar-range-end"
                          aria-label="Last day off"
                          aria-invalid={fieldErrors.endDate ? 'true' : undefined}
                          aria-describedby={fieldErrors.endDate ? 'calendar-end-date-error' : undefined}
                          type="date"
                          className="settings-time-input"
                          min={startDate || manilaTomorrow}
                          disabled={!canEditCalendar || !online || isMutating}
                          value={endDate}
                          onChange={(event) => {
                            setEndDate(event.target.value)
                            setPendingOverwrite(null)
                            setFieldErrors((current) => ({ ...current, endDate: undefined }))
                          }}
                        />
                        {fieldErrors.endDate ? <p id="calendar-end-date-error" className="field-error">{fieldErrors.endDate}</p> : null}
                      </div>
                    </div>
                  )}

                  <div className="settings-field-col">
                    <label htmlFor="calendar-entry-name" className="field-label-text">Label (optional)</label>
                    <input
                      id="calendar-entry-name"
                      aria-label="Entry name"
                      type="text"
                      className="settings-text-input"
                      maxLength={150}
                      placeholder={getDefaultEntryName(dayType, mode)}
                      disabled={!canEditCalendar || !online || isMutating}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value)
                        setPendingOverwrite(null)
                      }}
                    />
                  </div>

                  {dayType === 'machine_not_scheduled' ? (
                    <div className="settings-field-col">
                      <label htmlFor="calendar-reason" className="field-label-text">Reason (required)</label>
                      <input
                        id="calendar-reason"
                        aria-label="Reason"
                        aria-invalid={fieldErrors.reason ? 'true' : undefined}
                        aria-describedby={fieldErrors.reason ? 'calendar-reason-error' : undefined}
                        type="text"
                        className="settings-text-input"
                        maxLength={500}
                        placeholder="e.g. No orders, Planned maintenance"
                        disabled={!canEditCalendar || !online || isMutating}
                        value={reason}
                        onChange={(event) => {
                          setReason(event.target.value)
                          setPendingOverwrite(null)
                          setFieldErrors((current) => ({ ...current, reason: undefined }))
                        }}
                      />
                      {fieldErrors.reason ? <p id="calendar-reason-error" className="field-error">{fieldErrors.reason}</p> : null}
                    </div>
                  ) : null}

                  {backToWorkDate ? (
                    <div className="settings-calendar-preview">
                      <CalendarIcon size={14} aria-hidden="true" />
                      <span>Back to work: {formatBusinessDateDisplay(backToWorkDate)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="settings-calendar-picker-box">
                  <Calendar
                    mode={mode === 'range' ? 'range' : 'single'}
                    captionLayout="dropdown"
                    selected={calendarSelected}
                    onSelect={handleCalendarSelect}
                    defaultMonth={parseIsoDateLocal(startDate) || tomorrowDateObj}
                    startMonth={tomorrowDateObj}
                    endMonth={new Date(maxYear, 11, 31)}
                    disabled={tomorrowDateObj ? { before: tomorrowDateObj } : undefined}
                    modifiers={{
                      restDay: (date) => normalizedRestDays.has(WEEKDAYS[date.getDay()]),
                      holiday: (date) => holidayDateSet.has(formatIsoDateLocal(date)),
                      exclusion: (date) => exclusionDateSet.has(formatIsoDateLocal(date)),
                    }}
                    modifiersClassNames={{
                      restDay: 'is-rest-day',
                      holiday: 'is-holiday',
                      exclusion: 'is-exclusion',
                    }}
                  />
                  <div className="settings-calendar-legend" aria-hidden="true">
                    <span className="settings-legend-item"><span className="settings-legend-dot is-holiday" /> Holiday</span>
                    <span className="settings-legend-item"><span className="settings-legend-dot is-exclusion" /> Scheduled</span>
                    <span className="settings-legend-item"><span className="settings-legend-dot" /> Weekly rest</span>
                  </div>
                </div>
              </div>

              <div className="settings-dialog-footer">
                <button
                  type="button"
                  className="btn btn-ghost settings-action-btn"
                  disabled={isMutating}
                  onClick={closeScheduleModal}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary settings-action-btn"
                  disabled={!canEditCalendar || !online || isMutating}
                  onClick={handleAddEntry}
                >
                  {isMutating ? <RotateCw size={14} className="spin-icon" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                  <span>Add to calendar</span>
                </button>
              </div>
            </div>
          </>
        ) : null}
      </dialog>

      <dialog
        ref={confirmDialogRef}
        className="confirm-dialog"
        aria-labelledby="calendar-remove-title"
        onCancel={(event) => {
          if (isMutating) event.preventDefault()
          else closeConfirmRemove(true)
        }}
        onClose={() => setPendingRemove(null)}
      >
        {pendingRemove ? (
          <div className="confirm-dialog-content">
            <div className="confirm-dialog-header">
              <div className="confirm-dialog-icon danger">
                <AlertTriangle size={17} aria-hidden="true" />
              </div>
              <div>
                <h3 id="calendar-remove-title" className="confirm-dialog-title">
                  {pendingRemove.isRangeGroup ? 'Remove shutdown range' : 'Remove calendar exclusion'}
                </h3>
                <p className="confirm-dialog-message">
                  Remove <strong>{pendingRemove.name}</strong> (
                  {pendingRemove.isRangeGroup
                    ? `${pendingRemove.startDate} to ${pendingRemove.endDate}`
                    : pendingRemove.startDate}
                  )? Future dates will revert to normal shift rules.
                </p>
              </div>
            </div>
            <div className="confirm-dialog-actions">
              <button
                ref={confirmCancelRef}
                type="button"
                className="btn btn-ghost confirm-cancel-btn"
                disabled={isMutating}
                onClick={() => closeConfirmRemove(true)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={isMutating}
                onClick={confirmPendingRemove}
              >
                {isMutating ? 'Removing…' : 'Confirm remove'}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>

      {pendingRemoval || snackbarNotice ? (
        <div
          className="action-snackbar"
          role={pendingRemoval ? 'status' : snackbarNotice.type === 'error' ? 'alert' : 'status'}
          aria-live={snackbarNotice?.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {pendingRemoval ? null : snackbarNotice.type === 'error'
            ? <AlertCircle className="action-snackbar-result-error" size={16} aria-hidden="true" />
            : <CheckCircle2 className="action-snackbar-result-success" size={16} aria-hidden="true" />}
          <span className="action-snackbar-message">
            {pendingRemoval
              ? pendingRemoval.phase === 'saving'
                ? `Removing ${pendingRemoval.target.name}…`
                : `Removed ${pendingRemoval.target.name} (${pendingRemoval.target.isRangeGroup ? `${pendingRemoval.target.startDate} to ${pendingRemoval.target.endDate}` : pendingRemoval.target.startDate}). Undo available for 7 seconds.`
              : snackbarNotice.message}
          </span>
          {pendingRemoval ? (
            <button
              ref={undoButtonRef}
              type="button"
              className="action-snackbar-undo"
              hidden={pendingRemoval.phase === 'saving'}
              aria-label={`Undo remove ${pendingRemoval.target.name}`}
              onClick={undoPendingRemoval}
            >
              <Undo2 size={15} aria-hidden="true" />
              <span>Undo</span>
            </button>
          ) : (
            <button
              type="button"
              className="action-snackbar-dismiss"
              aria-label="Dismiss notification"
              onClick={() => setSnackbarNotice(null)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
          {pendingRemoval?.phase === 'undo' ? (
            <span className="action-snackbar-progress" aria-hidden="true">
              <span style={{ animationDuration: `${CALENDAR_REMOVE_UNDO_MS}ms` }} />
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
