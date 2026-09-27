import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Lock, Plus, RotateCw, Save } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { AnimatedTrashButton } from '../../../shared/components/AnimatedTrashButton.jsx'
import { getMachines } from '../machines/machinesService.js'
import { getOperationalSettings, getWatchdogDiagnostics, updateOperationalSettings } from './settingsService.js'
import { cloneSettings, settingsAreEqual, sortBreaks, validateOperationalSettings } from './settingsUtils.js'
import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'

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

            <div className="settings-matrix-container">
              <div className="settings-matrix-table-wrap">
                <table className="settings-matrix-table" aria-label="Sensor absence tolerance matrix">
                  <thead>
                    <tr>
                      <th scope="col" className="col-sensor">Sensor & Monitoring Point</th>
                      <th scope="col" className="col-detect">Absence Detection</th>
                      <th scope="col" className="col-trigger">Trigger Limit</th>
                      <th scope="col" className="col-recovery">Recovery Limit</th>
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
                                <Lock size={14} aria-hidden="true" className="settings-locked-icon" />
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

              <div className="settings-bounds-footer">
                <Info size={14} aria-hidden="true" className="bounds-icon" />
                <span>
                  Minimums: {constraints.triggerSeconds.minimumWhenEnabled}s trigger, {constraints.recoverySeconds.minimumWhenEnabled}s recovery. Maximum allowable trigger limit is {constraints.triggerSeconds.maximum}s.
                </span>
              </div>
            </div>
          </section>

          <section className="section-card settings-panel" aria-labelledby="shift-settings-title">
            <div className="section-heading">
              <div className="section-copy">
                <p className="section-eyebrow">Asia/Manila schedule</p>
                <h2 id="shift-settings-title">Shift and planned breaks</h2>
              </div>
            </div>

            <div className="settings-work-bar">
              <div className="work-bar-header">
                <strong>Operating hours</strong>
                {getBreakDurationLabel(draft.shiftSchedule.workStart, draft.shiftSchedule.workEnd) ? (
                  <span className="shift-duration-badge">
                    {getBreakDurationLabel(draft.shiftSchedule.workStart, draft.shiftSchedule.workEnd)}
                  </span>
                ) : null}
              </div>

              <div className="settings-work-grid">
                <label className="settings-field-group">
                  <span className="field-label-text">Work start</span>
                  <input
                    aria-label="Work start"
                    type="time"
                    className="settings-time-input"
                    disabled={editingBlocked}
                    value={draft.shiftSchedule.workStart}
                    onChange={(event) => updateSchedule('workStart', event.target.value)}
                  />
                </label>

                <label className="settings-field-group">
                  <span className="field-label-text">Work end</span>
                  <input
                    aria-label="Work end"
                    type="time"
                    className="settings-time-input"
                    disabled={editingBlocked}
                    value={draft.shiftSchedule.workEnd}
                    onChange={(event) => updateSchedule('workEnd', event.target.value)}
                  />
                </label>

                <label className="settings-field-group">
                  <span className="field-label-text">Grace period</span>
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

            <div className="settings-break-matrix-wrap">
              <div className="break-matrix-header">
                <div className="break-matrix-title">
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
                    <p>No planned breaks configured.</p>
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
                              <input
                                aria-label={`Break ${index + 1} name`}
                                className="settings-text-input break-name-field"
                                disabled={editingBlocked}
                                value={entry.name}
                                placeholder="e.g. Lunch Break"
                                maxLength={100}
                                onChange={(event) => updateBreak(index, 'name', event.target.value)}
                              />
                            </td>
                            <td className="col-break-time">
                              <input
                                aria-label={`Break ${index + 1} start`}
                                type="time"
                                className="settings-time-input"
                                disabled={editingBlocked}
                                value={entry.startTime}
                                onChange={(event) => updateBreak(index, 'startTime', event.target.value)}
                              />
                            </td>
                            <td className="col-break-time">
                              <input
                                aria-label={`Break ${index + 1} end`}
                                type="time"
                                className="settings-time-input"
                                disabled={editingBlocked}
                                value={entry.endTime}
                                onChange={(event) => updateBreak(index, 'endTime', event.target.value)}
                              />
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

              <button
                className="btn btn-secondary settings-add-break"
                type="button"
                disabled={editingBlocked || draft.shiftSchedule.breaks.length >= constraints.breaks.maximum}
                onClick={addBreak}
              >
                <Plus size={15} aria-hidden="true" /> Add break
              </button>
            </div>

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
              <button className="btn btn-primary" type="submit" disabled={!canSave}>
                <Save size={16} aria-hidden="true" /> {isSaving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </section>
        </form>
      )}
    </div>
  )
}
