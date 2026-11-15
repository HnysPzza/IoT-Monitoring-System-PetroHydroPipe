import Status from '../../../shared/components/Status.jsx'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './settings-compact.css'
import { AlertTriangle, Lock, Plus, RotateCcw, RotateCw, Save } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { AnimatedTrashButton } from '../../../shared/components/AnimatedTrashButton.jsx'
import { getMachines } from '../machines/machinesService.js'
import { getOperationalSettings, getWatchdogDiagnostics, updateOperationalSettings } from './settingsService.js'
import { cloneSettings, getMinuteBounds, getNextBreakSlot, getRotationStallSecondsBounds, settingsAreEqual, sortBreaks, validateOperationalSettings } from './settingsUtils.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'

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

let nextBreakKeyCounter = 1

function withBreakKey(entry, existingKey) {
  const copy = { name: entry.name, startTime: entry.startTime, endTime: entry.endTime }
  Object.defineProperty(copy, '_key', {
    value: existingKey || `break-key-${nextBreakKeyCounter++}`,
    enumerable: false,
    configurable: true,
  })
  return copy
}

function toDraft(settings, constraints) {
  const cloned = cloneSettings({ sensorThresholds: settings.sensorThresholds, shiftSchedule: settings.shiftSchedule })
  const spindleCode = constraints?.spindleSensorCode || 'S-03'
  const stallBounds = getRotationStallSecondsBounds(constraints?.rotationStallMs)
  if (cloned.sensorThresholds?.[spindleCode] && cloned.sensorThresholds[spindleCode].rotationStallMs === undefined) {
    cloned.sensorThresholds[spindleCode].rotationStallMs = stallBounds.defaultMs
  }
  if (Array.isArray(cloned.shiftSchedule?.breaks)) {
    cloned.shiftSchedule.breaks = cloned.shiftSchedule.breaks.map((entry) => withBreakKey(entry, entry._key))
  }
  return cloned
}

function numericValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function secondsToMinutesValue(seconds, enabled = true) {
  if (seconds === null || seconds === undefined) return ''
  if (!enabled && seconds % 60 !== 0) return Math.max(1, Math.round(seconds / 60))
  return Number((seconds / 60).toFixed(4))
}

function minutesInputToSeconds(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const minutes = Number(value)
  return Number.isFinite(minutes) ? Number((minutes * 60).toFixed(4)) : null
}

function msToSecondsValue(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return ''
  return Number((milliseconds / 1000).toFixed(3))
}

function secondsInputToMs(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
}

export default function SettingsSection() {
  const { token } = useAuth()
  const online = useNetworkOnline()
  const [settings, setSettings] = useState(null)
  const [constraints, setConstraints] = useState(null)
  const [draft, setDraft] = useState(null)
  const [notice, setNotice] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [enforcementBlocked, setEnforcementBlocked] = useState(false)

  const queryClient = useQueryClient()
  const machinesQuery = useAuthenticatedQuery({
    queryKey: queryKeys.machines.list,
    queryFn: ({ token: currentToken, signal }) => getMachines(currentToken, signal),
    staleTime: 300000,
    refetchOnWindowFocus: false,
  })
  const machine = machinesQuery.data?.machines?.find((item) => item.machineCode === 'M-01') || null
  const settingsQuery = useAuthenticatedQuery({
    queryKey: queryKeys.settings.machine(machine?.id || null),
    queryFn: ({ token: currentToken, signal }) => getOperationalSettings(currentToken, machine.id, signal),
    enabled: Boolean(machine),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  })
  const diagnosticsQuery = useAuthenticatedQuery({
    queryKey: queryKeys.settings.watchdog,
    queryFn: ({ token: currentToken, signal }) => getWatchdogDiagnostics(currentToken, signal),
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const watchdogMode = !online || diagnosticsQuery.isError || diagnosticsQuery.isPending ? 'unknown' : diagnosticsQuery.data?.watchdog?.mode || 'unknown'
  const isLoading = online && (machinesQuery.isPending || (Boolean(machine) && settingsQuery.isPending) || diagnosticsQuery.isPending)
  const [headerControlsSlot, setHeaderControlsSlot] = useState(() => document.getElementById('settings-header-controls'))
  const [headerVersionSlot, setHeaderVersionSlot] = useState(() => document.getElementById('settings-header-version'))

  useLayoutEffect(() => {
    const nextControls = document.getElementById('settings-header-controls')
    const nextVersion = document.getElementById('settings-header-version')
    if (nextControls !== headerControlsSlot) setHeaderControlsSlot(nextControls)
    if (nextVersion !== headerVersionSlot) setHeaderVersionSlot(nextVersion)
  }, [isLoading, headerControlsSlot, headerVersionSlot])

  useEffect(() => {
    const latest = settingsQuery.data?.settings
    const latestConstraints = settingsQuery.data?.constraints
    if (!latest || isSaving) return
    if (settings && /^\d+$/.test(String(latest.version)) && /^\d+$/.test(String(settings.version)) && BigInt(latest.version) < BigInt(settings.version)) {
      return
    }
    if (!draft || (settings && settingsAreEqual(draft, toDraft(settings, constraints || latestConstraints)))) {
      setSettings(latest)
      setConstraints(latestConstraints)
      setDraft(toDraft(latest, latestConstraints))
    } else if (settings && latest.version !== settings.version) {
      setConflict(true)
      setNotice({ type: 'error', message: 'Another Admin changed these settings. Your draft was kept; reload the latest version before saving.' })
    }
  }, [settingsQuery.data, isSaving])

  useEffect(() => {
    if (diagnosticsQuery.isError) setNotice({ type: 'error', message: 'Settings are read-only because watchdog diagnostics are unavailable.' })
    else if (machinesQuery.isError || settingsQuery.isError) setNotice({ type: 'error', message: machinesQuery.error?.message || settingsQuery.error?.message || 'Unable to load operational settings.' })
  }, [diagnosticsQuery.isError, machinesQuery.isError, machinesQuery.error, settingsQuery.isError, settingsQuery.error])

  async function reloadSettings() {
    setNotice(null)
    const machineResult = await machinesQuery.refetch()
    if (machineResult.isError) {
      setNotice({ type: 'error', message: machineResult.error?.message || 'Unable to load machines.' })
      return
    }
    const selected = machineResult.data?.machines?.find((item) => item.machineCode === 'M-01')
    if (!selected) {
      setNotice({ type: 'error', message: 'Spiral Mill 01 is not available.' })
      return
    }
    const [settingsResult, diagnosticsResult] = await Promise.allSettled([
      queryClient.fetchQuery({ queryKey: queryKeys.settings.machine(selected.id), queryFn: ({ signal }) => getOperationalSettings(token, selected.id, signal), staleTime: 0 }),
      diagnosticsQuery.refetch({ throwOnError: true }),
    ])
    if (settingsResult.status === 'rejected') {
      setNotice({ type: 'error', message: settingsResult.reason?.message || 'Unable to load operational settings.' })
      return
    }
    setSettings(settingsResult.value.settings)
    setConstraints(settingsResult.value.constraints)
    setDraft(toDraft(settingsResult.value.settings, settingsResult.value.constraints))
    setConflict(false)
    if (diagnosticsResult.status === 'rejected') setNotice({ type: 'error', message: 'Settings are read-only because watchdog diagnostics are unavailable.' })
    else setEnforcementBlocked(false)
  }

  const baseline = useMemo(() => (settings ? toDraft(settings, constraints) : null), [settings, constraints])
  const isDirty = useMemo(() => !settingsAreEqual(draft, baseline), [draft, baseline])
  const errors = useMemo(() => (
    draft && constraints ? validateOperationalSettings(draft, constraints) : {}
  ), [draft, constraints])
  const triggerMinutes = useMemo(() => (
    constraints ? getMinuteBounds(constraints.triggerSeconds) : null
  ), [constraints])
  const recoveryMinutes = useMemo(() => (
    constraints ? getMinuteBounds(constraints.recoverySeconds) : null
  ), [constraints])
  const spindleSensorCode = constraints?.spindleSensorCode || 'S-03'
  const stallSecondsBounds = useMemo(() => (
    constraints ? getRotationStallSecondsBounds(constraints.rotationStallMs) : null
  ), [constraints])
  const editingBlocked = watchdogMode === 'unknown' || conflict || enforcementBlocked
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
    const validTrigger = Number.isInteger(current.triggerSeconds)
      && current.triggerSeconds % 60 === 0
      && current.triggerSeconds >= triggerMinutes.minimumWhenEnabled * 60
      && current.triggerSeconds <= triggerMinutes.maximum * 60
    const validRecovery = Number.isInteger(current.recoverySeconds)
      && current.recoverySeconds % 60 === 0
      && current.recoverySeconds >= recoveryMinutes.minimumWhenEnabled * 60
      && current.recoverySeconds <= recoveryMinutes.maximum * 60

    if (enabled && (!validTrigger || !validRecovery)) {
      setDraft((value) => ({
        ...value,
        sensorThresholds: {
          ...value.sensorThresholds,
          [sensorCode]: {
            ...value.sensorThresholds[sensorCode],
            absenceDetectionEnabled: true,
            triggerSeconds: validTrigger ? current.triggerSeconds : triggerMinutes.minimumWhenEnabled * 60,
            recoverySeconds: validRecovery ? current.recoverySeconds : recoveryMinutes.minimumWhenEnabled * 60,
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
      entryIndex === index ? withBreakKey({ ...entry, [field]: value }, entry._key) : entry
    ))
    updateSchedule('breaks', breaks)
  }

  function addBreak() {
    if (draft.shiftSchedule.breaks.length >= constraints.breaks.maximum) return
    const nextSlot = getNextBreakSlot(draft.shiftSchedule)
    const existingNames = new Set(draft.shiftSchedule.breaks.map((entry) => entry.name.trim().toLowerCase()))
    let nextNumber = draft.shiftSchedule.breaks.length + 1
    while (existingNames.has(`break ${nextNumber}`)) {
      nextNumber += 1
    }
    updateSchedule('breaks', [
      ...draft.shiftSchedule.breaks,
      withBreakKey({ name: `Break ${nextNumber}`, startTime: nextSlot.startTime, endTime: nextSlot.endTime }),
    ])
  }

  function removeBreak(index) {
    updateSchedule('breaks', draft.shiftSchedule.breaks.filter((_, entryIndex) => entryIndex !== index))
  }

  async function saveSettings(event) {
    event?.preventDefault?.()
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
      setDraft(toDraft(payload.settings, constraints))
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all, refetchType: 'active' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all, refetchType: 'active' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all, refetchType: 'active' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all, refetchType: 'active' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.downtime.all, refetchType: 'active' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview.all, refetchType: 'active' })
      setNotice({ type: 'success', message: 'Operational settings saved.' })
    } catch (error) {
      if (error.code === 'SETTINGS_VERSION_CONFLICT') {
        setConflict(true)
        setNotice({ type: 'error', message: 'Another Admin changed these settings. Your draft was kept; reload the latest version before saving.' })
      } else if (error.code === 'SETTINGS_ENFORCEMENT_ACTIVE') {
        setEnforcementBlocked(true)
        setConflict(true)
        setNotice({ type: 'error', message: 'Settings became read-only because watchdog enforcement is active.' })
      } else {
        setNotice({ type: 'error', message: error.message || 'Unable to save operational settings.' })
      }
    } finally {
      setIsSaving(false)
    }
  }

  const saveHandlerRef = useRef(null)
  saveHandlerRef.current = (event) => {
    if (canSave) {
      void saveSettings(event)
    }
  }

  useEffect(() => {
    function handleSaveShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveHandlerRef.current?.(event)
      }
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [])

  if (!online && (!draft || !constraints)) {
    return (
      <div className="notice notice-error dashboard-alert" role="alert">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>Unable to refresh while offline.</span>
        <button className="btn btn-secondary settings-inline-retry-btn" type="button" onClick={reloadSettings}>
          <RotateCw size={14} aria-hidden="true" /> Retry
        </button>
      </div>
    )
  }

  if (isLoading) {
    return <section className="section-card settings-panel"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /></section>
  }

  const headerControls = headerControlsSlot?.isConnected ? headerControlsSlot : document.getElementById('settings-header-controls')
  const headerVersion = headerVersionSlot?.isConnected ? headerVersionSlot : document.getElementById('settings-header-version')
  const version = draft && constraints && isDirty ? <span className="settings-version">Unsaved changes</span> : null
  const headerContextPill = machine ? <span className="settings-timezone">{machine.machineCode} · Operational thresholds</span> : null
  function discardSettings() {
    const latest = conflict && settingsQuery.data?.settings?.version !== settings.version ? settingsQuery.data : null
    const nextSettings = latest?.settings || settings
    const nextConstraints = latest?.constraints || constraints
    setSettings(nextSettings)
    if (latest) setConstraints(latest.constraints)
    setDraft(toDraft(nextSettings, nextConstraints))
    setConflict(false)
    setNotice(null)
  }
  const actions = draft && constraints ? (
    <div className="settings-header-actions">
      {version}
      <button className="btn btn-secondary settings-action-btn settings-discard-btn" type="button" aria-label="Discard" title="Discard unsaved changes" disabled={!isDirty || isSaving} onClick={discardSettings}><RotateCcw size={14} aria-hidden="true" /><span className="settings-action-label">Discard</span></button>
      {conflict || enforcementBlocked ? <button className="btn btn-secondary settings-action-btn settings-reload-btn" type="button" aria-label="Reload latest" title="Load latest server settings" onClick={reloadSettings}><RotateCw size={14} aria-hidden="true" /><span className="settings-action-label">Reload latest</span></button> : null}
      <button className="btn btn-primary settings-action-btn settings-save-btn" type="submit" form="operational-settings-form" aria-label={isSaving ? 'Saving…' : 'Save'} title={isSaving ? 'Saving…' : 'Save settings (Ctrl+S)'} disabled={!canSave}>
        {isSaving ? <RotateCw size={14} className="spin-icon" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
        <span className="settings-action-label">{isSaving ? 'Saving…' : 'Save'}</span>
      </button>
    </div>
  ) : null

  return (
    <div className="settings-layout">
      <h1 className="sr-only">Operational settings</h1>
      {headerVersion ? createPortal(headerContextPill, headerVersion) : null}
      {headerControls ? createPortal(actions, headerControls) : actions}
      {!online ? <div className="notice notice-error" role="alert">Settings may be stale. Unable to refresh while offline.</div> : null}
      {notice ? <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : null}<span>{notice.message}</span></div> : null}

      {!draft || !constraints ? (
        <section className="section-card section-placeholder"><div className="section-copy"><p className="section-eyebrow">Configuration unavailable</p><h2>Unable to load operational settings</h2><p>No changes can be made until the current server configuration is loaded.</p><button className="btn btn-secondary" type="button" onClick={reloadSettings}><RotateCw size={16} aria-hidden="true" /> Retry</button></div></section>
      ) : (
        <form id="operational-settings-form" className="settings-form" noValidate onSubmit={saveSettings}>
          <section className="section-card settings-panel" aria-labelledby="operational-settings-title">
            <div className="section-heading">
              <div className="section-copy">
                <h2 id="operational-settings-title">{machine.name}</h2>
              </div>
              <Status
                tone={watchdogMode === 'enforce' ? 'active' : watchdogMode === 'observe' ? 'fault' : 'offline'}
                title={watchdogMode === 'enforce' ? 'Watchdog actively enforces thresholds' : watchdogMode === 'observe' ? 'Watchdog evaluates thresholds without creating downtime' : 'Watchdog status unavailable'}
              >
                Watchdog {watchdogMode}
              </Status>
            </div>
            {watchdogMode === 'observe' ? <p className="settings-mode-note">Observe mode evaluates these values but does not create operational downtime or alerts.</p> : null}
            {watchdogMode === 'enforce' ? <p className="settings-mode-note">Enforcement is active. Saved changes apply immediately to live watchdog evaluation and connected sensors.</p> : null}
            <p className="settings-field-hint">
              Trigger limit sets how long missing pulses are tolerated before opening downtime; recovery limit sets how long normal pulses must resume to close it.
            </p>

            <div className="settings-matrix-container">
              <div className="settings-matrix-table-wrap">
                <table className="settings-matrix-table" aria-label="Sensor absence tolerance matrix">
                  <thead>
                    <tr>
                      <th scope="col" className="col-sensor">Sensor & Monitoring Point</th>
                      <th scope="col" className="col-detect">Absence Detection</th>
                      <th scope="col" className="col-trigger">Trigger Limit ({triggerMinutes.minimumWhenEnabled}–{triggerMinutes.maximum}m)</th>
                      <th scope="col" className="col-recovery">Recovery Limit ({recoveryMinutes.minimumWhenEnabled}–{recoveryMinutes.maximum}m)</th>
                      <th scope="col" className="col-status">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {constraints.sensorCodes.map((sensorCode) => {
                      const threshold = draft.sensorThresholds[sensorCode]
                      const baselineThreshold = baseline?.sensorThresholds?.[sensorCode]
                      const isRowDirty = Boolean(baselineThreshold && !settingsAreEqual(threshold, baselineThreshold))
                      const isOutput = sensorCode === constraints.outputSensorCode
                      const isSpindle = sensorCode === spindleSensorCode
                      const sensorLabel = getSensorLabel(sensorCode, 'Plant Sensor')
                      const sensorPurpose = getSensorPurpose(sensorCode)
                      const stallError = isSpindle ? errors[`${sensorCode}.rotationStallMs`] : null
                      const recoveryError = errors[`${sensorCode}.recoverySeconds`] || null
                      const triggerError = errors[`${sensorCode}.triggerSeconds`]
                        || (errors[sensorCode] && errors[sensorCode] !== stallError && errors[sensorCode] !== recoveryError ? errors[sensorCode] : null)
                      const hasError = Boolean(stallError || triggerError || recoveryError)
                      const isStallError = Boolean(stallError)

                      if (isOutput) {
                        return (
                          <tr key={sensorCode} className="settings-matrix-row is-locked-row">
                            <td className="col-sensor" data-label="Sensor & Monitoring Point">
                              <div className="settings-sensor-identity">
                                <span className="settings-sensor-badge is-locked">{sensorCode}</span>
                                <div className="settings-sensor-meta">
                                  <strong className="settings-sensor-title">{sensorLabel}</strong>
                                  {sensorPurpose ? <span className="settings-sensor-purpose">{sensorPurpose}</span> : null}
                                </div>
                              </div>
                            </td>
                            <td colSpan={4} className="settings-locked-cell" data-label="Configuration">
                              <div className="settings-locked-banner">
                                <Lock size={14} aria-hidden="true" className="settings-locked-icon" />
                                <span>Locked: S-05 counts output and cannot trigger absence downtime.</span>
                                <input
                                  type="number"
                                  className="sr-only"
                                  aria-label={`${sensorCode} trigger minutes`}
                                  disabled
                                  value=""
                                  readOnly
                                />
                                <input
                                  type="number"
                                  className="sr-only"
                                  aria-label={`${sensorCode} recovery minutes`}
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
                        <tr key={sensorCode} className={`settings-matrix-row ${hasError ? 'has-row-error' : ''} ${isRowDirty ? 'is-dirty-row' : ''}`.trim()}>
                          <td className="col-sensor" data-label="Sensor & Monitoring Point">
                            <div className="settings-sensor-identity">
                              <span className="settings-sensor-badge">{sensorCode}</span>
                              <div className="settings-sensor-meta">
                                <div className="settings-sensor-header-row">
                                  <strong className="settings-sensor-title">{sensorLabel}</strong>
                                  {isRowDirty ? <span className="settings-dirty-pill">Edited</span> : null}
                                </div>
                                {sensorPurpose ? <span className="settings-sensor-purpose">{sensorPurpose}</span> : null}
                                {isSpindle && stallSecondsBounds ? (
                                  <div className="settings-spindle-stall">
                                    <span className="settings-spindle-stall-label" id="s03-stall-range">
                                      Rotation stall ({stallSecondsBounds.minimum}–{stallSecondsBounds.maximum}s)
                                    </span>
                                    <div className="settings-input-group settings-stall-input-group">
                                      <input
                                        aria-label={`${sensorCode} rotation stall seconds`}
                                        aria-describedby={isStallError ? 's03-stall-range s03-stall-error' : 's03-stall-range'}
                                        aria-invalid={isStallError ? 'true' : undefined}
                                        type="number"
                                        className="settings-num-input"
                                        min={stallSecondsBounds.minimum}
                                        max={stallSecondsBounds.maximum}
                                        step={0.1}
                                        disabled={editingBlocked}
                                        value={msToSecondsValue(threshold.rotationStallMs)}
                                        onChange={(event) => updateThreshold(sensorCode, 'rotationStallMs', secondsInputToMs(event.target.value))}
                                      />
                                      <span className="input-group-unit" aria-hidden="true">sec</span>
                                    </div>
                                    {isStallError ? <p id="s03-stall-error" className="field-error">{stallError}</p> : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="col-detect" data-label="Absence Detection">
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
                          <td className="col-trigger" data-label={`Trigger Limit (${triggerMinutes.minimumWhenEnabled}–${triggerMinutes.maximum}m)`}>
                            <div className="settings-input-group">
                              <input
                                aria-label={`${sensorCode} trigger minutes`}
                                aria-invalid={triggerError ? 'true' : undefined}
                                aria-describedby={triggerError ? `${sensorCode}-trigger-error` : undefined}
                                type="number"
                                className="settings-num-input"
                                min={triggerMinutes.minimumWhenEnabled}
                                max={triggerMinutes.maximum}
                                step={1}
                                disabled={editingBlocked || !threshold.absenceDetectionEnabled}
                                value={secondsToMinutesValue(threshold.triggerSeconds, threshold.absenceDetectionEnabled)}
                                onChange={(event) => updateThreshold(sensorCode, 'triggerSeconds', minutesInputToSeconds(event.target.value))}
                              />
                              <span className="input-group-unit" aria-hidden="true">min</span>
                            </div>
                            {triggerError ? <p id={`${sensorCode}-trigger-error`} className="field-error">{triggerError}</p> : null}
                          </td>
                          <td className="col-recovery" data-label={`Recovery Limit (${recoveryMinutes.minimumWhenEnabled}–${recoveryMinutes.maximum}m)`}>
                            <div className="settings-input-group">
                              <input
                                aria-label={`${sensorCode} recovery minutes`}
                                aria-invalid={recoveryError ? 'true' : undefined}
                                aria-describedby={recoveryError ? `${sensorCode}-recovery-error` : undefined}
                                type="number"
                                className="settings-num-input"
                                min={recoveryMinutes.minimumWhenEnabled}
                                max={recoveryMinutes.maximum}
                                step={1}
                                disabled={editingBlocked || !threshold.absenceDetectionEnabled}
                                value={secondsToMinutesValue(threshold.recoverySeconds, threshold.absenceDetectionEnabled)}
                                onChange={(event) => updateThreshold(sensorCode, 'recoverySeconds', minutesInputToSeconds(event.target.value))}
                              />
                              <span className="input-group-unit" aria-hidden="true">min</span>
                            </div>
                            {recoveryError ? <p id={`${sensorCode}-recovery-error`} className="field-error">{recoveryError}</p> : null}
                          </td>
                          <td className="col-status" data-label="Status">
                            <Status
                              tone={threshold.absenceDetectionEnabled ? 'active' : 'offline'}
                              title={threshold.absenceDetectionEnabled ? 'Absence detection active' : 'Absence detection disabled'}
                            >
                              {threshold.absenceDetectionEnabled ? 'Active' : 'Disabled'}
                            </Status>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="section-card settings-panel" aria-labelledby="shift-settings-title">
            <div className="section-heading">
              <div className="section-copy">
                <div className="settings-shift-title"><h2 id="shift-settings-title">Shift and planned breaks</h2><span className="settings-timezone">{constraints.timeZone}</span></div>
              </div>
              {getBreakDurationLabel(draft.shiftSchedule.workStart, draft.shiftSchedule.workEnd) ? (
                <span className="shift-duration-badge">
                  {getBreakDurationLabel(draft.shiftSchedule.workStart, draft.shiftSchedule.workEnd)}
                </span>
              ) : null}
            </div>

            <div className="settings-work-bar">
              <div className="work-bar-header">
                <strong>Operating hours</strong>
              </div>

              <div className="settings-work-grid">
                <label className="settings-field-group">
                  <span className="field-label-text">Work start</span>
                  <input
                    aria-label="Work start"
                    aria-invalid={errors.schedule ? 'true' : undefined}
                    aria-describedby={errors.schedule ? 'settings-schedule-error' : undefined}
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
                    aria-invalid={errors.schedule ? 'true' : undefined}
                    aria-describedby={errors.schedule ? 'settings-schedule-error' : undefined}
                    type="time"
                    className="settings-time-input"
                    disabled={editingBlocked}
                    value={draft.shiftSchedule.workEnd}
                    onChange={(event) => updateSchedule('workEnd', event.target.value)}
                  />
                </label>

                <label className="settings-field-group">
                  <span className="field-label-text">
                    Grace period ({constraints.rampUpGraceMinutes.minimum}–{constraints.rampUpGraceMinutes.maximum}m)
                  </span>
                  <div className="input-grace-wrap">
                    <input
                      aria-label="Grace period minutes"
                      aria-invalid={errors.rampUpGraceMinutes ? 'true' : undefined}
                      aria-describedby={errors.rampUpGraceMinutes ? 'settings-grace-hint settings-grace-error' : 'settings-grace-hint'}
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
                  <span id="settings-grace-hint" className="settings-field-hint">
                    Applies at shift start and after each planned break.
                  </span>
                </label>
              </div>

              {errors.schedule ? <p id="settings-schedule-error" className="field-error">{errors.schedule}</p> : null}
              {errors.rampUpGraceMinutes ? <p id="settings-grace-error" className="field-error">{errors.rampUpGraceMinutes}</p> : null}
            </div>

            <div className="settings-break-matrix-wrap">
              <div className="break-matrix-header">
                <div className="break-matrix-title">
                  <strong>Planned Rest Breaks</strong>
                  <span className="break-count-pill">
                    {draft.shiftSchedule.breaks.length} / {constraints.breaks.maximum}
                  </span>
                </div>
                <button
                  className="btn btn-secondary settings-add-break"
                  type="button"
                  disabled={editingBlocked || draft.shiftSchedule.breaks.length >= constraints.breaks.maximum}
                  onClick={addBreak}
                >
                  <Plus size={15} aria-hidden="true" /> Add break
                </button>
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
                        const hasBreakError = !durationLabel || Boolean(errors.breaks)
                        return (
                          <tr key={entry._key || `${index}-${entry.startTime}`} className="settings-break-row-item">
                            <td className="col-break-name" data-label="Break Name">
                              <input
                                aria-label={`Break ${index + 1} name`}
                                aria-invalid={!entry.name?.trim() || Boolean(errors.breaks) ? 'true' : undefined}
                                aria-describedby={errors.breaks ? 'settings-breaks-error' : undefined}
                                className="settings-text-input break-name-field"
                                disabled={editingBlocked}
                                value={entry.name}
                                placeholder="e.g. Lunch Break"
                                maxLength={100}
                                onChange={(event) => updateBreak(index, 'name', event.target.value)}
                              />
                            </td>
                            <td className="col-break-time" data-label="Start Time">
                              <input
                                aria-label={`Break ${index + 1} start`}
                                aria-invalid={hasBreakError ? 'true' : undefined}
                                aria-describedby={errors.breaks ? 'settings-breaks-error' : undefined}
                                type="time"
                                className="settings-time-input"
                                disabled={editingBlocked}
                                value={entry.startTime}
                                onChange={(event) => updateBreak(index, 'startTime', event.target.value)}
                              />
                            </td>
                            <td className="col-break-time" data-label="End Time">
                              <input
                                aria-label={`Break ${index + 1} end`}
                                aria-invalid={hasBreakError ? 'true' : undefined}
                                aria-describedby={errors.breaks ? 'settings-breaks-error' : undefined}
                                type="time"
                                className="settings-time-input"
                                disabled={editingBlocked}
                                value={entry.endTime}
                                onChange={(event) => updateBreak(index, 'endTime', event.target.value)}
                              />
                            </td>
                            <td className="col-break-duration" data-label="Duration">
                              {durationLabel ? (
                                <span className="break-duration-stack">
                                  <span className="break-duration-pill">{durationLabel}</span>
                                  {draft.shiftSchedule.rampUpGraceMinutes > 0 ? (
                                    <span className="break-grace-note" title="Post-break ramp-up grace buffer">
                                      +{draft.shiftSchedule.rampUpGraceMinutes}m grace
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <Status tone="danger">Invalid</Status>
                              )}
                            </td>
                            <td className="col-break-action" data-label="Action">
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

              {errors.breaks ? <p id="settings-breaks-error" className="field-error break-error-note">{errors.breaks}</p> : null}
            </div>
          </section>
        </form>
      )}
    </div>
  )
}
