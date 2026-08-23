import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Moon, Plus, RotateCw, Save, Sun, Trash2 } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useTheme } from '../../../shared/hooks/useTheme.js'
import { AnimatedTrashButton } from '../../../shared/components/AnimatedTrashButton.jsx'
import { getMachines } from '../machines/machinesService.js'
import { getOperationalSettings, getWatchdogDiagnostics, updateOperationalSettings } from './settingsService.js'
import { cloneSettings, settingsAreEqual, sortBreaks, validateOperationalSettings } from './settingsUtils.js'
import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'

function ClockIcon({ size = 16, className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-clock-icon ${className}`}
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}

function RotateCcwIcon({ size = 16, className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-rotate-ccw-icon ${className}`}
      {...props}
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function LockIcon({ size = 16, className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-lock-icon ${className}`}
      {...props}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function ShieldAlertIcon({ size = 16, className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-shield-alert-icon ${className}`}
      {...props}
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}

function CoffeeIcon({ size = 16, className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-coffee-icon ${className}`}
      {...props}
    >
      <path d="M10 2v2" />
      <path d="M14 2v2" />
      <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
      <path d="M6 2v2" />
    </svg>
  )
}

function HourglassIcon({ size = 16, className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-hourglass-icon ${className}`}
      {...props}
    >
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </svg>
  )
}

function CalendarIcon({ size = 16, className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-calendar-icon ${className}`}
      {...props}
    >
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </svg>
  )
}

function getBreakDurationLabel(start, end) {
  if (!start || !end) return null
  const [sH, sM] = start.split(':').map(Number)
  const [eH, eM] = end.split(':').map(Number)
  if (Number.isNaN(sH) || Number.isNaN(sM) || Number.isNaN(eH) || Number.isNaN(eM)) return null
  const diffMinutes = (eH * 60 + eM) - (sH * 60 + sM)
  if (diffMinutes <= 0) return null
  const hours = Math.floor(diffMinutes / 60)
  const mins = diffMinutes % 60
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

function toDraft(settings) {
  return cloneSettings({ sensorThresholds: settings.sensorThresholds, shiftSchedule: settings.shiftSchedule })
}

function numericValue(value) {
  return value === '' ? null : Number(value)
}

export default function SettingsSection() {
  const { token } = useAuth()
  const { theme, setTheme } = useTheme()
  const [machine, setMachine] = useState(null)
  const [settings, setSettings] = useState(null)
  const [constraints, setConstraints] = useState(null)
  const [draft, setDraft] = useState(null)
  const [watchdogMode, setWatchdogMode] = useState('unknown')
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setIsLoading(true)
      setNotice(null)
      setConflict(false)
      try {
        const machinePayload = await getMachines(token)
        const selectedMachine = machinePayload.machines?.find((item) => item.machineCode === 'M-01')
        if (!selectedMachine) throw new Error('Spiral Mill 01 is not available.')
        const [settingsResult, diagnosticsResult] = await Promise.allSettled([
          getOperationalSettings(token, selectedMachine.id),
          getWatchdogDiagnostics(token),
        ])
        if (!active) return
        if (settingsResult.status === 'rejected') throw settingsResult.reason
        const payload = settingsResult.value
        setMachine(selectedMachine)
        setSettings(payload.settings)
        setConstraints(payload.constraints)
        setDraft(toDraft(payload.settings))
        if (diagnosticsResult.status === 'fulfilled') {
          setWatchdogMode(diagnosticsResult.value.watchdog?.mode || 'unknown')
        } else {
          setWatchdogMode('unknown')
          setNotice({ type: 'error', message: 'Settings are read-only because watchdog diagnostics are unavailable.' })
        }
      } catch (error) {
        if (!active) return
        setMachine(null)
        setSettings(null)
        setConstraints(null)
        setDraft(null)
        setWatchdogMode('unknown')
        setNotice({ type: 'error', message: error.message || 'Unable to load operational settings.' })
      } finally {
        if (active) setIsLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token, reloadKey])

  const baseline = useMemo(() => (settings ? toDraft(settings) : null), [settings])
  const isDirty = useMemo(() => !settingsAreEqual(draft, baseline), [draft, baseline])
  const errors = useMemo(() => (
    draft && constraints ? validateOperationalSettings(draft, constraints) : {}
  ), [draft, constraints])
  const editingBlocked = watchdogMode === 'enforce' || watchdogMode === 'unknown' || conflict
  const canSave = isDirty && !editingBlocked && !isSaving && Object.keys(errors).length === 0

  useEffect(() => {
    function warnBeforeUnload(event) {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    function guardInternalNavigation(event) {
      if (!isDirty || event.defaultPrevented || (event.button != null && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target.closest?.('a[href]')
      if (!link || link.target === '_blank' || new URL(link.href).origin !== window.location.origin) return
      if (!window.confirm('Discard unsaved operational settings and leave this page?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', guardInternalNavigation, true)
    return () => document.removeEventListener('click', guardInternalNavigation, true)
  }, [isDirty])

  function updateThreshold(sensorCode, field, value) {
    setDraft((current) => ({
      ...current,
      sensorThresholds: {
        ...current.sensorThresholds,
        [sensorCode]: { ...current.sensorThresholds[sensorCode], [field]: value },
      },
    }))
    setNotice(null)
  }

  function toggleThreshold(sensorCode, enabled) {
    const current = draft.sensorThresholds[sensorCode]
    if (enabled && current.triggerSeconds === null) {
      setDraft((value) => ({
        ...value,
        sensorThresholds: {
          ...value.sensorThresholds,
          [sensorCode]: {
            ...value.sensorThresholds[sensorCode],
            absenceDetectionEnabled: true,
            triggerSeconds: constraints.triggerSeconds.minimumWhenEnabled,
            recoverySeconds: constraints.recoverySeconds.minimumWhenEnabled,
          },
        },
      }))
      setNotice(null)
      return
    }
    updateThreshold(sensorCode, 'absenceDetectionEnabled', enabled)
  }

  function updateSchedule(field, value) {
    setDraft((current) => ({ ...current, shiftSchedule: { ...current.shiftSchedule, [field]: value } }))
    setNotice(null)
  }

  function updateBreak(index, field, value) {
    const breaks = draft.shiftSchedule.breaks.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, [field]: value } : entry
    ))
    updateSchedule('breaks', breaks)
  }

  function addBreak() {
    if (draft.shiftSchedule.breaks.length >= constraints.breaks.maximum) return
    updateSchedule('breaks', [
      ...draft.shiftSchedule.breaks,
      { name: `Break ${draft.shiftSchedule.breaks.length + 1}`, startTime: '10:00', endTime: '10:15' },
    ])
  }

  function removeBreak(index) {
    updateSchedule('breaks', draft.shiftSchedule.breaks.filter((_, entryIndex) => entryIndex !== index))
  }

  async function saveSettings(event) {
    event.preventDefault()
    if (!canSave) return
    setIsSaving(true)
    setNotice(null)
    try {
      const payload = await updateOperationalSettings(token, machine.id, {
        expectedVersion: settings.version,
        sensorThresholds: draft.sensorThresholds,
        shiftSchedule: { ...draft.shiftSchedule, breaks: sortBreaks(draft.shiftSchedule.breaks) },
      })
      setSettings(payload.settings)
      setDraft(toDraft(payload.settings))
      setNotice({ type: 'success', message: 'Operational settings saved.' })
    } catch (error) {
      if (error.code === 'SETTINGS_VERSION_CONFLICT') {
        setConflict(true)
        setNotice({ type: 'error', message: 'Another Admin changed these settings. Your draft was kept; reload the latest version before saving.' })
      } else if (error.code === 'SETTINGS_ENFORCEMENT_ACTIVE') {
        setWatchdogMode('enforce')
        setNotice({ type: 'error', message: 'Settings became read-only because watchdog enforcement is active.' })
      } else {
        setNotice({ type: 'error', message: error.message || 'Unable to save operational settings.' })
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <section className="section-card settings-panel"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /></section>
  }

  return (
    <div className="settings-layout">
      {notice ? <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : null}<span>{notice.message}</span></div> : null}

      {!draft || !constraints ? (
        <section className="section-card section-placeholder"><div className="section-copy"><p className="section-eyebrow">Configuration unavailable</p><h2>Unable to load operational settings</h2><p>No changes can be made until the current server configuration is loaded.</p><button className="btn btn-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}><RotateCw size={16} aria-hidden="true" /> Retry</button></div></section>
      ) : (
        <form className="settings-form" onSubmit={saveSettings}>
          <section className="section-card settings-panel" aria-labelledby="operational-settings-title">
            <div className="section-heading">
              <div className="section-copy">
                <p className="section-eyebrow">Operational configuration</p>
                <h2 id="operational-settings-title">{machine.name}</h2>
              </div>
              <span className={`status-badge ${watchdogMode === 'observe' ? 'status-idle' : watchdogMode === 'enforce' ? 'status-downtime' : 'status-inactive'}`}>
                Watchdog {watchdogMode}
              </span>
            </div>
            {watchdogMode === 'observe' ? <p className="settings-mode-note">Observe mode evaluates these values but does not create operational downtime or alerts.</p> : null}
            {watchdogMode === 'enforce' ? <p className="settings-mode-note is-warning">Enforcement is active. Settings are read-only until it is disabled outside this page.</p> : null}

            {/* Streamlined Matrix/Row Layout for Sensors */}
            <div className="settings-matrix-container">
              <div className="settings-matrix-table-wrap">
                <table className="settings-matrix-table" aria-label="Sensor absence tolerance matrix">
                  <thead>
                    <tr>
                      <th scope="col" className="col-sensor">
                        <span className="th-content"><ShieldAlertIcon size={14} aria-hidden="true" /> Sensor & Monitoring Point</span>
                      </th>
                      <th scope="col" className="col-detect">Absence Detection</th>
                      <th scope="col" className="col-trigger">
                        <span className="th-content"><ClockIcon size={14} aria-hidden="true" /> Trigger Limit</span>
                      </th>
                      <th scope="col" className="col-recovery">
                        <span className="th-content"><RotateCcwIcon size={14} aria-hidden="true" /> Recovery Limit</span>
                      </th>
                      <th scope="col" className="col-status">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {constraints.sensorCodes.map((sensorCode) => {
                      const threshold = draft.sensorThresholds[sensorCode]
                      const isOutput = sensorCode === constraints.outputSensorCode
                      const sensorLabel = getSensorLabel(sensorCode, 'Plant Sensor')
                      const hasError = Boolean(errors[sensorCode])

                      if (isOutput) {
                        return (
                          <tr key={sensorCode} className="settings-matrix-row is-locked-row">
                            <td className="col-sensor">
                              <div className="settings-sensor-identity">
                                <span className="settings-sensor-badge is-locked">{sensorCode}</span>
                                <div className="settings-sensor-meta">
                                  <strong className="settings-sensor-title">{sensorLabel}</strong>
                                </div>
                              </div>
                            </td>
                            <td colSpan={4} className="settings-locked-cell">
                              <div className="settings-locked-banner">
                                <LockIcon size={15} aria-hidden="true" className="locked-icon" />
                                <span>Locked: S-05 counts output and cannot trigger absence downtime.</span>
                                {/* Hidden inputs to fulfill test & form accessibility contract */}
                                <input
                                  type="number"
                                  className="sr-only"
                                  aria-label={`${sensorCode} trigger seconds`}
                                  disabled
                                  value=""
                                  readOnly
                                />
                                <input
                                  type="number"
                                  className="sr-only"
                                  aria-label={`${sensorCode} recovery seconds`}
                                  disabled
                                  value=""
                                  readOnly
                                />
                              </div>
                            </td>
                          </tr>
                        )
                      }

                      return (
                        <tr key={sensorCode} className={`settings-matrix-row ${hasError ? 'has-row-error' : ''}`}>
                          <td className="col-sensor">
                            <div className="settings-sensor-identity">
                              <span className="settings-sensor-badge">{sensorCode}</span>
                              <div className="settings-sensor-meta">
                                <strong className="settings-sensor-title">{sensorLabel}</strong>
                              </div>
                            </div>
                          </td>
                          <td className="col-detect">
                            <label className="settings-check">
                              <input
                                type="checkbox"
                                disabled={editingBlocked}
                                checked={threshold.absenceDetectionEnabled}
                                onChange={(event) => toggleThreshold(sensorCode, event.target.checked)}
                              />
                              <span>Detect missing pulse</span>
                            </label>
                          </td>
                          <td className="col-trigger">
                            <div className="settings-input-group">
                              <ClockIcon size={14} className="input-group-icon" aria-hidden="true" />
                              <input
                                aria-label={`${sensorCode} trigger seconds`}
                                type="number"
                                className="settings-num-input"
                                min={constraints.triggerSeconds.minimumWhenEnabled}
                                max={constraints.triggerSeconds.maximum}
                                disabled={editingBlocked || !threshold.absenceDetectionEnabled}
                                value={threshold.triggerSeconds ?? ''}
                                onChange={(event) => updateThreshold(sensorCode, 'triggerSeconds', numericValue(event.target.value))}
                              />
                              <span className="input-group-unit" aria-hidden="true">s</span>
                            </div>
                            {hasError ? <p className="field-error">{errors[sensorCode]}</p> : null}
                          </td>
                          <td className="col-recovery">
                            <div className="settings-input-group">
                              <RotateCcwIcon size={14} className="input-group-icon" aria-hidden="true" />
                              <input
                                aria-label={`${sensorCode} recovery seconds`}
                                type="number"
                                className="settings-num-input"
                                min={constraints.recoverySeconds.minimumWhenEnabled}
                                max={constraints.recoverySeconds.maximum}
                                disabled={editingBlocked || !threshold.absenceDetectionEnabled}
                                value={threshold.recoverySeconds ?? ''}
                                onChange={(event) => updateThreshold(sensorCode, 'recoverySeconds', numericValue(event.target.value))}
                              />
                              <span className="input-group-unit" aria-hidden="true">s</span>
                            </div>
                          </td>
                          <td className="col-status">
                            {threshold.absenceDetectionEnabled ? (
                              <span className="settings-status-indicator is-active" title="Absence detection active">
                                <span className="status-dot" aria-hidden="true" />
                                <span className="status-label">Active</span>
                              </span>
                            ) : (
                              <span className="settings-status-indicator is-disabled" title="Absence detection disabled">
                                <span className="status-dot" aria-hidden="true" />
                                <span className="status-label">Disabled</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Consolidated Bounds Rules Footer */}
              <div className="settings-bounds-footer">
                <ShieldAlertIcon size={15} aria-hidden="true" className="bounds-icon" />
                <span>
                  Minimums: {constraints.triggerSeconds.minimumWhenEnabled}s trigger, {constraints.recoverySeconds.minimumWhenEnabled}s recovery. Maximum allowable trigger limit is {constraints.triggerSeconds.maximum}s.
                </span>
              </div>
            </div>
          </section>

          {/* Shift Schedule & Unified Planned Breaks */}
          <section className="section-card settings-panel" aria-labelledby="shift-settings-title">
            <div className="section-heading">
              <div className="section-copy">
                <p className="section-eyebrow">Asia/Manila schedule</p>
                <h2 id="shift-settings-title">Shift and planned breaks</h2>
              </div>
            </div>

            {/* Integrated Work Window Control Bar */}
            <div className="settings-work-bar">
              <div className="work-bar-header">
                <div className="work-bar-title-wrap">
                  <CalendarIcon size={16} className="work-bar-icon" aria-hidden="true" />
                  <strong>Operating Window & Startup Buffer</strong>
                </div>
                {getBreakDurationLabel(draft.shiftSchedule.workStart, draft.shiftSchedule.workEnd) ? (
                  <span className="shift-duration-badge">
                    {getBreakDurationLabel(draft.shiftSchedule.workStart, draft.shiftSchedule.workEnd)} Operating Window
                  </span>
                ) : null}
              </div>

              <div className="settings-work-grid">
                <label className="settings-field-group">
                  <span className="field-label-text">
                    <ClockIcon size={13} aria-hidden="true" /> Work start
                  </span>
                  <div className="input-time-wrap">
                    <input
                      aria-label="Work start"
                      type="time"
                      className="settings-time-input"
                      disabled={editingBlocked}
                      value={draft.shiftSchedule.workStart}
                      onChange={(event) => updateSchedule('workStart', event.target.value)}
                    />
                  </div>
                </label>

                <label className="settings-field-group">
                  <span className="field-label-text">
                    <ClockIcon size={13} aria-hidden="true" /> Work end
                  </span>
                  <div className="input-time-wrap">
                    <input
                      aria-label="Work end"
                      type="time"
                      className="settings-time-input"
                      disabled={editingBlocked}
                      value={draft.shiftSchedule.workEnd}
                      onChange={(event) => updateSchedule('workEnd', event.target.value)}
                    />
                  </div>
                </label>

                <label className="settings-field-group">
                  <span className="field-label-text">
                    <HourglassIcon size={13} aria-hidden="true" /> Grace period
                  </span>
                  <div className="input-grace-wrap">
                    <input
                      aria-label="Grace period minutes"
                      type="number"
                      className="settings-num-input"
                      min={constraints.rampUpGraceMinutes.minimum}
                      max={constraints.rampUpGraceMinutes.maximum}
                      disabled={editingBlocked}
                      value={draft.shiftSchedule.rampUpGraceMinutes}
                      onChange={(event) => updateSchedule('rampUpGraceMinutes', numericValue(event.target.value))}
                    />
                    <span className="input-unit-tag" aria-hidden="true">mins</span>
                  </div>
                </label>
              </div>

              {errors.schedule ? <p className="field-error">{errors.schedule}</p> : null}
              {errors.rampUpGraceMinutes ? <p className="field-error">{errors.rampUpGraceMinutes}</p> : null}
            </div>

            {/* Unified Break Matrix (Single Outer Container) */}
            <div className="settings-break-matrix-wrap">
              <div className="break-matrix-header">
                <div className="break-matrix-title">
                  <CoffeeIcon size={16} className="coffee-icon" aria-hidden="true" />
                  <strong>Planned Rest Breaks</strong>
                  <span className="break-count-pill">
                    {draft.shiftSchedule.breaks.length} / {constraints.breaks.maximum}
                  </span>
                </div>
                <p className="break-matrix-hint">Rest periods deduct from unplanned downtime calculations.</p>
              </div>

              <div className="settings-break-table-container">
                {draft.shiftSchedule.breaks.length === 0 ? (
                  <div className="settings-breaks-empty">
                    <CoffeeIcon size={22} className="empty-icon" aria-hidden="true" />
                    <p>No planned rest breaks scheduled. Click &ldquo;Add break&rdquo; below to create one.</p>
                  </div>
                ) : (
                  <table className="settings-break-table" aria-label="Planned breaks table">
                    <thead>
                      <tr>
                        <th scope="col" className="col-break-name">Break Name</th>
                        <th scope="col" className="col-break-time">Start Time</th>
                        <th scope="col" className="col-break-time">End Time</th>
                        <th scope="col" className="col-break-duration">Duration</th>
                        <th scope="col" className="col-break-action"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.shiftSchedule.breaks.map((entry, index) => {
                        const durationLabel = getBreakDurationLabel(entry.startTime, entry.endTime)
                        return (
                          <tr key={index} className="settings-break-row-item">
                            <td className="col-break-name">
                              <div className="break-name-input-wrap">
                                <CoffeeIcon size={14} className="break-name-icon" aria-hidden="true" />
                                <input
                                  aria-label={`Break ${index + 1} name`}
                                  className="settings-text-input break-name-field"
                                  disabled={editingBlocked}
                                  value={entry.name}
                                  placeholder="e.g. Lunch Break"
                                  maxLength={100}
                                  onChange={(event) => updateBreak(index, 'name', event.target.value)}
                                />
                              </div>
                            </td>
                            <td className="col-break-time">
                              <div className="break-time-input-wrap">
                                <ClockIcon size={13} className="break-time-icon" aria-hidden="true" />
                                <input
                                  aria-label={`Break ${index + 1} start`}
                                  type="time"
                                  className="settings-time-input"
                                  disabled={editingBlocked}
                                  value={entry.startTime}
                                  onChange={(event) => updateBreak(index, 'startTime', event.target.value)}
                                />
                              </div>
                            </td>
                            <td className="col-break-time">
                              <div className="break-time-input-wrap">
                                <ClockIcon size={13} className="break-time-icon" aria-hidden="true" />
                                <input
                                  aria-label={`Break ${index + 1} end`}
                                  type="time"
                                  className="settings-time-input"
                                  disabled={editingBlocked}
                                  value={entry.endTime}
                                  onChange={(event) => updateBreak(index, 'endTime', event.target.value)}
                                />
                              </div>
                            </td>
                            <td className="col-break-duration">
                              {durationLabel ? (
                                <span className="break-duration-pill">{durationLabel}</span>
                              ) : (
                                <span className="break-duration-pill is-invalid">Invalid</span>
                              )}
                            </td>
                            <td className="col-break-action">
                              <AnimatedTrashButton
                                className="break-trash-btn"
                                title={`Remove ${entry.name}`}
                                ariaLabel={`Remove ${entry.name}`}
                                disabled={editingBlocked}
                                onClick={() => removeBreak(index)}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {errors.breaks ? <p className="field-error break-error-note">{errors.breaks}</p> : null}

              <div className="break-matrix-footer">
                <button
                  className="btn btn-secondary settings-add-break"
                  type="button"
                  disabled={editingBlocked || draft.shiftSchedule.breaks.length >= constraints.breaks.maximum}
                  onClick={addBreak}
                >
                  <Plus size={15} aria-hidden="true" /> Add break
                </button>
              </div>
            </div>

            {/* Settings Action Controls */}
            <div className="settings-actions">
              <span>{isDirty ? 'Unsaved changes' : `Version ${settings.version}`}</span>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!isDirty || isSaving}
                onClick={() => { setDraft(toDraft(settings)); setConflict(false); setNotice(null) }}
              >
                Discard changes
              </button>
              {conflict ? (
                <button className="btn btn-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>
                  <RotateCw size={16} aria-hidden="true" /> Reload latest
                </button>
              ) : null}
              <button className="btn btn-success" type="submit" disabled={!canSave}>
                <Save size={16} aria-hidden="true" /> {isSaving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </section>
        </form>
      )}

      <section className="section-card settings-panel" aria-labelledby="display-settings-title">
        <div className="section-copy"><p className="section-eyebrow">Display preferences</p><h2 id="display-settings-title">Interface</h2><p>Choose the appearance for this workstation.</p></div>
        <div className="settings-row"><div className="settings-copy"><h3>Interface theme</h3><p>Switch between dark and light interfaces.</p></div><div className="theme-toggle" role="group" aria-label="Interface theme"><button className={`theme-option ${theme === 'dark' ? 'is-selected' : ''}`} type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={18} aria-hidden="true" /> Dark</button><button className={`theme-option ${theme === 'light' ? 'is-selected' : ''}`} type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={18} aria-hidden="true" /> Light</button></div></div>
      </section>
    </div>
  )
}
