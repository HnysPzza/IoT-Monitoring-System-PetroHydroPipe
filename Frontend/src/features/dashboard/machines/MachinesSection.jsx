import { useOutletContext } from 'react-router'
import { AlertTriangle, Cpu, RotateCw } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getMachineStatusClass, getSensorStatusClass } from '../../../shared/utils/statusClasses.js'
import { connectivityLabel } from '../live/livePresentation.js'
import { useLiveFeedStream } from '../live/useLiveFeedStream.js'

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
  const outlet = useOutletContext()
  const fallbackStream = useLiveFeedStream(outlet?.liveFeed ? null : token)
  const liveFeed = outlet?.liveFeed || fallbackStream

  const machine = liveFeed.machine
  const sensors = liveFeed.sensors
  const capturedAt = liveFeed.monitoring?.capturedAt || null
  const requestState = liveFeed.state
  const error = liveFeed.error
  const lastUpdated = liveFeed.lastUpdated
  const isRefreshing = liveFeed.isRefreshing
  const sensorCountLabel = `${sensors.length} sensor${sensors.length === 1 ? '' : 's'}`

  const refreshSnapshot = () => liveFeed.reload()

  if (requestState === 'loading' && !machine) {
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

  if (requestState === 'error' && !machine) {
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
              className="icon-button live-refresh-icon"
              type="button"
              aria-label="Refresh machines"
              disabled={isRefreshing}
              onClick={refreshSnapshot}
            >
              <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
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
