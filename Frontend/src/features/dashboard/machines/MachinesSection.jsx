import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Cpu, RotateCw } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getMachineStatusClass, getSensorStatusClass } from '../../../shared/utils/statusClasses.js'
import { getLiveFeed } from '../live/liveService.js'
import { connectivityLabel } from '../live/livePresentation.js'

function EmptyMachinesState({ isRefreshing = false, onRefresh }) {
  return (
    <section className="section-card section-placeholder" aria-labelledby="machines-empty-title">
      <div className="section-copy">
        <p className="section-eyebrow">No live machine</p>
        <h2 id="machines-empty-title">No machines found</h2>
        <p>Spiral Mill 01 was not returned by the live monitoring source.</p>
        <button className="btn btn-secondary" type="button" aria-label="Refresh machines" disabled={isRefreshing} onClick={onRefresh}>
          <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>
    </section>
  )
}

function formatSuccessfulUpdate(date) {
  return date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  })
}

export default function MachinesSection() {
  const { token } = useAuth()
  const tokenKey = token || 'anonymous'
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotTokenKey, setSnapshotTokenKey] = useState('')
  const [requestState, setRequestState] = useState('loading')
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const requestIdRef = useRef(0)
  const snapshotRef = useRef(null)

  const currentSnapshot = snapshotTokenKey === tokenKey ? snapshot : null
  const machine = currentSnapshot?.machine || null
  const sensors = currentSnapshot?.sensors || []
  const capturedAt = currentSnapshot?.capturedAt || null
  const sensorCountLabel = `${sensors.length} sensor${sensors.length === 1 ? '' : 's'}`
  const isRefreshing = requestState === 'loading' && Boolean(currentSnapshot)
  const requestStateRef = useRef(requestState)
  requestStateRef.current = requestState

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (requestStateRef.current !== 'loading') setRefresh((current) => current + 1)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [tokenKey])

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    let isCancelled = false

    setRequestState('loading')
    setError('')

    async function loadSnapshot() {
      try {
        const payload = await getLiveFeed(token)
        if (isCancelled || requestId !== requestIdRef.current) return

        const nextSnapshot = {
          machine: payload.machine || null,
          sensors: payload.sensors || [],
          capturedAt: payload.monitoring?.capturedAt || null,
        }
        snapshotRef.current = { tokenKey, snapshot: nextSnapshot }
        setSnapshot(nextSnapshot)
        setSnapshotTokenKey(tokenKey)
        setLastUpdated(new Date())
        setRequestState(nextSnapshot.machine ? 'success' : 'empty')
      } catch (requestError) {
        if (isCancelled || requestId !== requestIdRef.current) return

        setError(requestError.message || 'Unable to load live machine status.')
        setRequestState(snapshotRef.current?.tokenKey === tokenKey ? 'stale' : 'error')
      }
    }

    loadSnapshot()

    return () => {
      isCancelled = true
    }
  }, [refresh, token, tokenKey])

  const refreshSnapshot = () => setRefresh((current) => current + 1)

  if (requestState === 'loading' && !currentSnapshot) {
    return (
      <div className="machines-layout">
        <section className="section-card" role="status" aria-live="polite">
          <span className="sr-only">Loading live machine status...</span>
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-panel" />
        </section>
      </div>
    )
  }

  if (requestState === 'error') {
    return (
      <div className="machines-layout">
        <section className="section-card section-placeholder" aria-labelledby="machines-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Live status unavailable</p>
            <h2 id="machines-error-title">Unable to load live machine status</h2>
            <p role="alert">{error}</p>
            <button className="btn btn-secondary" type="button" onClick={refreshSnapshot}>Retry machines</button>
          </div>
        </section>
      </div>
    )
  }

  if (!machine) {
    return <div className="machines-layout"><EmptyMachinesState isRefreshing={isRefreshing} onRefresh={refreshSnapshot} /></div>
  }

  return (
    <div className="machines-layout">
      {isRefreshing ? <div className="notice dashboard-alert" role="status" aria-live="polite">Refreshing live machine status...</div> : null}
      {requestState === 'stale' ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Live machine status is stale. Showing the last successful result from{' '}
            <time dateTime={lastUpdated?.toISOString()}>
              {lastUpdated ? formatSuccessfulUpdate(lastUpdated) : 'an earlier update'}
            </time>
            . {error}
          </span>
          <button className="btn btn-secondary table-action-button" type="button" onClick={refreshSnapshot}>Retry machines</button>
        </div>
      ) : null}

      <section className="section-card machine-admin-hero" aria-labelledby="machine-admin-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Machine monitoring</p>
            <h2 id="machine-admin-title">{machine.name}</h2>
          </div>
          <div className="live-heading-badges">
            <button
              className="btn btn-secondary table-action-button"
              type="button"
              aria-label="Refresh machines"
              disabled={isRefreshing}
              onClick={refreshSnapshot}
            >
              <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
              Refresh
            </button>
            <span className={`status-badge ${getMachineStatusClass(machine.status)}`}>{machine.status}</span>
          </div>
        </div>

        <div className="live-machine-grid">
          <div><span className="live-metric-label">Machine code</span><strong>{machine.machineCode}</strong></div>
          <div><span className="live-metric-label">Location</span><strong>{machine.location || 'Not set'}</strong></div>
          <div><span className="live-metric-label">Sensors</span><strong>{sensorCountLabel}</strong></div>
          <div>
            <span className="live-metric-label">Status snapshot</span>
            <strong><time dateTime={capturedAt || undefined}>{formatShortDateTime(capturedAt)}</time></strong>
          </div>
        </div>
      </section>

      <section className="section-card" aria-labelledby="sensor-admin-title">
        <div className="section-heading">
          <div><p className="section-eyebrow">Sensor monitoring</p><h2 id="sensor-admin-title">Inductive proximity sensors</h2></div>
          <div className="live-refresh"><span className="section-chip"><Cpu size={16} aria-hidden="true" />{sensors.length} shown</span></div>
        </div>

        {sensors.length === 0 ? <p className="table-muted">No sensors were returned by the live monitoring source.</p> : (
          <div className="admin-sensor-grid">
            {sensors.map((sensor) => {
              const statusClass = getSensorStatusClass(sensor.status)
              return (
                <article key={sensor.id} className={`machine-card admin-sensor-card ${statusClass}`}>
                  <div className="machine-card-header">
                    <div><p className="machine-id">{sensor.sensorCode}</p><h3>{getSensorLabel(sensor.sensorCode, sensor.label)}</h3></div>
                    <span className={`status-badge ${statusClass}`}>{sensor.status}</span>
                  </div>
                  <dl className="machine-meta live-sensor-meta">
                    <div><dt>Device ID</dt><dd>{sensor.esp32DeviceId}</dd></div>
                    <div><dt>Connection</dt><dd>{connectivityLabel(sensor)}</dd></div>
                    <div className="admin-sensor-meta-wide"><dt>Purpose</dt><dd>{getSensorPurpose(sensor.sensorCode, sensor.purpose)}</dd></div>
                    <div className="admin-sensor-meta-wide"><dt>Last Event</dt><dd>{formatShortDateTime(sensor.lastEventAt, 'No event yet')}</dd></div>
                  </dl>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
