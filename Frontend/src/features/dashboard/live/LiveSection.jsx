import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, PauseCircle, RotateCw, Wifi, WifiOff, Wrench } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { formatLiveDateTime } from '../../../shared/utils/formatters.js'
import { formatSignal } from '../../../shared/utils/signalFormatters.js'
import { getLiveStatusClass } from '../../../shared/utils/statusClasses.js'
import { getLiveFeed } from './liveService.js'
import { presentLiveSensors } from './livePresentation.js'

const POLL_INTERVAL_MS = 15000
const statusFilters = ['All', 'Running', 'Idle', 'Fault', 'Downtime']

function StatusIcon({ status }) {
  if (status === 'Running') return <Wifi size={18} aria-hidden="true" />
  if (status === 'Downtime') return <AlertTriangle size={18} aria-hidden="true" />
  if (status === 'Fault') return <Wrench size={18} aria-hidden="true" />
  return <PauseCircle size={18} aria-hidden="true" />
}

export default function LiveSection() {
  const { token } = useAuth()
  const [statusFilter, setStatusFilter] = useState('All')
  const [machine, setMachine] = useState(null)
  const [sensors, setSensors] = useState([])
  const [monitoring, setMonitoring] = useState({ mode: 'unknown', capturedAt: null })
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const hasSnapshotRef = useRef(false)
  const requestIdRef = useRef(0)

  const loadLiveFeed = useCallback(async ({ initial = false } = {}) => {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    const requestId = ++requestIdRef.current
    if (initial) setIsLoading(true)
    else setIsRefreshing(true)

    try {
      const payload = await getLiveFeed(token)
      if (!mountedRef.current || requestId !== requestIdRef.current) return false
      setMachine(payload.machine || null)
      setSensors(payload.sensors || [])
      setMonitoring(payload.monitoring || { mode: 'unknown', capturedAt: null })
      hasSnapshotRef.current = Boolean(payload.machine)
      setNotice(null)
      return true
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return false
      setNotice({
        type: 'error',
        message: hasSnapshotRef.current
          ? `Live data is stale. ${error.message || 'The latest refresh failed.'}`
          : error.message || 'Unable to load live sensor feed.',
      })
      return false
    } finally {
      if (requestId === requestIdRef.current) inFlightRef.current = false
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [token])

  useEffect(() => {
    mountedRef.current = true
    requestIdRef.current += 1
    inFlightRef.current = false
    setMachine(null)
    setSensors([])
    hasSnapshotRef.current = false
    setMonitoring({ mode: 'unknown', capturedAt: null })
    setNotice(null)
    loadLiveFeed({ initial: true })

    const intervalId = window.setInterval(() => {
      if (!document.hidden) loadLiveFeed()
    }, POLL_INTERVAL_MS)
    function handleVisibilityChange() {
      if (!document.hidden) loadLiveFeed()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      inFlightRef.current = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [token, loadLiveFeed])

  const presentedSensors = useMemo(
    () => presentLiveSensors(sensors, monitoring.mode),
    [sensors, monitoring.mode],
  )
  const filteredSensors = useMemo(
    () => presentedSensors.filter((sensor) => statusFilter === 'All' || sensor.displayStatus === statusFilter),
    [presentedSensors, statusFilter],
  )

  if (isLoading && !machine) {
    return <div className="live-layout"><section className="section-card"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /></section></div>
  }

  return (
    <div className="live-layout">
      {notice ? <div className="notice notice-error dashboard-alert" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{notice.message}</span></div> : null}

      {machine ? (
        <section className="section-card live-hero-card" aria-labelledby="live-title">
          <div className="section-heading">
            <div><p className="section-eyebrow">Live feed</p><h2 id="live-title">{machine.name}</h2></div>
            <div className="live-heading-badges">
              <span className="status-badge status-inactive">Watchdog {monitoring.mode}</span>
              <span className={`status-badge ${getLiveStatusClass(machine.status)}`}><StatusIcon status={machine.status} />{machine.status}</span>
            </div>
          </div>
          <div className="live-machine-grid">
            <div><span className="live-metric-label">Machine</span><strong>{machine.machineCode}</strong></div>
            <div><span className="live-metric-label">Location</span><strong>{machine.location || 'Not set'}</strong></div>
            <div><span className="live-metric-label">Snapshot</span><strong>{formatLiveDateTime(monitoring.capturedAt)}</strong></div>
            <div><span className="live-metric-label">Inductive Sensors</span><strong>{machine.activeSensors} active</strong></div>
          </div>
        </section>
      ) : (
        <section className="section-card section-placeholder" aria-labelledby="live-empty-title"><div className="section-copy"><p className="section-eyebrow">No live source</p><h2 id="live-empty-title">Live feed is unavailable</h2><p>Check the machine connection and refresh the live feed.</p></div></section>
      )}

      <section className="section-card live-controls-card" aria-label="Live feed controls">
        <div className="live-filter-group" role="group" aria-label="Filter sensors by status">
          {statusFilters.map((status) => <button key={status} className={`trend-mode-button ${statusFilter === status ? 'is-selected' : ''}`} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>{status}</button>)}
        </div>
        <div className="live-refresh">
          <span>Automatic refresh every 15 seconds</span>
          <button className="btn btn-success table-action-button live-refresh-button" type="button" aria-label="Refresh live feed" disabled={isRefreshing} onClick={() => loadLiveFeed()}><RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />Refresh</button>
        </div>
      </section>

      <section className="live-sensor-grid" aria-label="Five inductive proximity sensor statuses">
        {filteredSensors.length === 0 ? (
          <section className="section-card section-placeholder" aria-labelledby="live-filter-empty-title"><div className="section-copy"><p className="section-eyebrow">No matching sensors</p><h2 id="live-filter-empty-title">No sensors match this filter</h2><p>Try another status filter or refresh the live feed.</p></div></section>
        ) : filteredSensors.map((sensor) => (
          <article key={sensor.id} className={`machine-card live-sensor-card ${getLiveStatusClass(sensor.displayStatus)}`}>
            <div className="machine-card-header">
              <div><p className="machine-id">{sensor.sensorCode}</p><h3>{getSensorLabel(sensor.sensorCode, sensor.label)}</h3></div>
              <span className={`status-badge ${getLiveStatusClass(sensor.displayStatus)}`}><StatusIcon status={sensor.displayStatus} />{sensor.displayStatus}</span>
            </div>
            <p className="live-detection-state">{sensor.stateLabel}</p>
            <dl className="machine-meta live-sensor-meta">
              <div><dt>Signal</dt><dd>{formatSignal(sensor.signal)}</dd></div>
              <div><dt>Last Event</dt><dd>{formatLiveDateTime(sensor.lastEventAt)}</dd></div>
              <div><dt>Connection</dt><dd className={sensor.monitoring?.connectivityState === 'offline' ? 'live-offline' : ''}>{sensor.monitoring?.connectivityState === 'online' ? <CheckCircle2 size={14} aria-hidden="true" /> : null}{sensor.monitoring?.connectivityState === 'offline' ? <WifiOff size={14} aria-hidden="true" /> : null}<span className="live-connectivity-label">{sensor.connectivityLabel}</span></dd></div>
            </dl>
            <div className="live-purpose-row">{sensor.displayStatus === 'Downtime' ? <Wrench size={16} aria-hidden="true" /> : <Activity size={16} aria-hidden="true" />}<span>{getSensorPurpose(sensor.sensorCode, sensor.purpose)}</span></div>
          </article>
        ))}
      </section>
    </div>
  )
}
