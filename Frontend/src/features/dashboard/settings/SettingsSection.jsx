import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Moon, Plus, RotateCw, Save, Sun, Trash2 } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useTheme } from '../../../shared/hooks/useTheme.js'
import { getMachines } from '../machines/machinesService.js'
import { getOperationalSettings, getWatchdogDiagnostics, updateOperationalSettings } from './settingsService.js'
import { cloneSettings, settingsAreEqual, sortBreaks, validateOperationalSettings } from './settingsUtils.js'

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
            <div className="section-heading"><div className="section-copy"><p className="section-eyebrow">Operational configuration</p><h2 id="operational-settings-title">{machine.name}</h2><p>Changes are saved together and take effect on the next watchdog evaluation.</p></div><span className={`status-badge ${watchdogMode === 'observe' ? 'status-idle' : watchdogMode === 'enforce' ? 'status-downtime' : 'status-inactive'}`}>Watchdog {watchdogMode}</span></div>
            {watchdogMode === 'observe' ? <p className="settings-mode-note">Observe mode evaluates these values but does not create operational downtime or alerts.</p> : null}
            {watchdogMode === 'enforce' ? <p className="settings-mode-note is-warning">Enforcement is active. Settings are read-only until it is disabled outside this page.</p> : null}
            <div className="settings-sensor-grid">
              {constraints.sensorCodes.map((sensorCode) => {
                const threshold = draft.sensorThresholds[sensorCode]
                const isOutput = sensorCode === constraints.outputSensorCode
                return (
                  <fieldset key={sensorCode} className="settings-sensor-card" disabled={editingBlocked || isOutput}>
                    <legend>{sensorCode}{isOutput ? ' Production output' : ''}</legend>
                    <label className="settings-check"><input type="checkbox" checked={threshold.absenceDetectionEnabled} onChange={(event) => toggleThreshold(sensorCode, event.target.checked)} />Detect missing pulse</label>
                    <label>Trigger seconds<input aria-label={`${sensorCode} trigger seconds`} type="number" min={constraints.triggerSeconds.minimumWhenEnabled} max={constraints.triggerSeconds.maximum} disabled={!threshold.absenceDetectionEnabled} value={threshold.triggerSeconds ?? ''} onChange={(event) => updateThreshold(sensorCode, 'triggerSeconds', numericValue(event.target.value))} /></label>
                    <label>Recovery seconds<input aria-label={`${sensorCode} recovery seconds`} type="number" min={constraints.recoverySeconds.minimumWhenEnabled} max={constraints.recoverySeconds.maximum} disabled={!threshold.absenceDetectionEnabled} value={threshold.recoverySeconds ?? ''} onChange={(event) => updateThreshold(sensorCode, 'recoverySeconds', numericValue(event.target.value))} /></label>
                    <small>{isOutput ? 'Locked: S-05 counts output and cannot trigger absence downtime.' : `Minimums: ${constraints.triggerSeconds.minimumWhenEnabled}s trigger, ${constraints.recoverySeconds.minimumWhenEnabled}s recovery.`}</small>
                    {errors[sensorCode] ? <p className="field-error">{errors[sensorCode]}</p> : null}
                  </fieldset>
                )
              })}
            </div>
          </section>

          <section className="section-card settings-panel" aria-labelledby="shift-settings-title">
            <div className="section-heading"><div className="section-copy"><p className="section-eyebrow">Asia/Manila schedule</p><h2 id="shift-settings-title">Shift and planned breaks</h2><p>Absence detection is suspended outside the work window and during planned breaks.</p></div></div>
            <div className="settings-time-grid">
              <label>Work start<input aria-label="Work start" type="time" disabled={editingBlocked} value={draft.shiftSchedule.workStart} onChange={(event) => updateSchedule('workStart', event.target.value)} /></label>
              <label>Work end<input aria-label="Work end" type="time" disabled={editingBlocked} value={draft.shiftSchedule.workEnd} onChange={(event) => updateSchedule('workEnd', event.target.value)} /></label>
              <label>Grace period minutes<input aria-label="Grace period minutes" type="number" min={constraints.rampUpGraceMinutes.minimum} max={constraints.rampUpGraceMinutes.maximum} disabled={editingBlocked} value={draft.shiftSchedule.rampUpGraceMinutes} onChange={(event) => updateSchedule('rampUpGraceMinutes', numericValue(event.target.value))} /></label>
            </div>
            {errors.schedule ? <p className="field-error">{errors.schedule}</p> : null}
            {errors.rampUpGraceMinutes ? <p className="field-error">{errors.rampUpGraceMinutes}</p> : null}
            <div className="settings-break-list">
              {draft.shiftSchedule.breaks.map((entry, index) => (
                <div className="settings-break-row" key={index}>
                  <label>Break name<input aria-label={`Break ${index + 1} name`} disabled={editingBlocked} value={entry.name} maxLength={100} onChange={(event) => updateBreak(index, 'name', event.target.value)} /></label>
                  <label>Start<input aria-label={`Break ${index + 1} start`} type="time" disabled={editingBlocked} value={entry.startTime} onChange={(event) => updateBreak(index, 'startTime', event.target.value)} /></label>
                  <label>End<input aria-label={`Break ${index + 1} end`} type="time" disabled={editingBlocked} value={entry.endTime} onChange={(event) => updateBreak(index, 'endTime', event.target.value)} /></label>
                  <button className="icon-button" type="button" aria-label={`Remove ${entry.name}`} disabled={editingBlocked} onClick={() => removeBreak(index)}><Trash2 size={17} aria-hidden="true" /></button>
                </div>
              ))}
              {errors.breaks ? <p className="field-error">{errors.breaks}</p> : null}
              <button className="btn btn-secondary settings-add-break" type="button" disabled={editingBlocked || draft.shiftSchedule.breaks.length >= constraints.breaks.maximum} onClick={addBreak}><Plus size={16} aria-hidden="true" /> Add break</button>
            </div>
            <div className="settings-actions">
              <span>{isDirty ? 'Unsaved changes' : `Version ${settings.version}`}</span>
              <button className="btn btn-secondary" type="button" disabled={!isDirty || isSaving} onClick={() => { setDraft(toDraft(settings)); setConflict(false); setNotice(null) }}>Discard changes</button>
              {conflict ? <button className="btn btn-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}><RotateCw size={16} aria-hidden="true" /> Reload latest</button> : null}
              <button className="btn btn-success" type="submit" disabled={!canSave}><Save size={16} aria-hidden="true" /> {isSaving ? 'Saving…' : 'Save settings'}</button>
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
