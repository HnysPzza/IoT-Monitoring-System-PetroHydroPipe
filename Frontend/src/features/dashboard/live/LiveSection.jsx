import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, PauseCircle, RotateCw, Wifi, Wrench } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'
import { formatLiveDateTime } from '../../../shared/utils/formatters.js'
import { formatSignal } from '../../../shared/utils/signalFormatters.js'
import { getLiveStatusClass } from '../../../shared/utils/statusClasses.js'
import { getLiveFeed } from './liveService.js'

const statusFilters = ['All', 'Running', 'Idle', 'Downtime']

// Picks an icon that matches the sensor status shown in the badge.
function StatusIcon({ status }) {
  if (status === 'Running') return <Wifi size={18} aria-hidden="true" />
  if (status === 'Downtime') return <AlertTriangle size={18} aria-hidden="true" />
  return <PauseCircle size={18} aria-hidden="true" />
}

export default function LiveSection() {
  const { token } = useAuth()
  const [statusFilter, setStatusFilter] = useState('All')
  const [machine, setMachine] = useState(null)
  const [sensors, setSensors] = useState([])
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  async function loadLiveFeed({ silent = false } = {}) {
    if (silent) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    setNotice(null)

    try {
      const payload = await getLiveFeed(token)
      setMachine(payload.machine || null)
      setSensors(payload.sensors || [])
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to load live sensor feed.' })
      setMachine(null)
      setSensors([])
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    loadLiveFeed()
  }, [token])

  // Filter stays local so changing tabs does not call the backend again.
  const filteredSensors = useMemo(
    () => sensors.filter((sensor) => statusFilter === 'All' || sensor.status === statusFilter),
    [sensors, statusFilter],
  )

  if (isLoading) {
    return (
      <div className="live-layout">
        <section className="section-card">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-panel" />
        </section>
      </div>
    )
  }

  return (
    <div className="live-layout">
      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      ) : null}

      {machine ? (
        <section className="section-card live-hero-card" aria-labelledby="live-title">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Live feed</p>
              <h2 id="live-title">{machine.name}</h2>
            </div>
            <span className={`status-badge ${getLiveStatusClass(machine.status)}`}>
              <StatusIcon status={machine.status} />
              {machine.status}
            </span>
          </div>

          <div className="live-machine-grid">
            <div>
              <span className="live-metric-label">Machine</span>
              <strong>{machine.machineCode}</strong>
            </div>
            <div>
              <span className="live-metric-label">Location</span>
              <strong>{machine.location || 'Not set'}</strong>
            </div>
            <div>
              <span className="live-metric-label">Last Update</span>
              <strong>{formatLiveDateTime(machine.lastUpdated)}</strong>
            </div>
            <div>
              <span className="live-metric-label">Inductive Sensors</span>
              <strong>{machine.activeSensors} active</strong>
            </div>
          </div>
        </section>
      ) : (
        <section className="section-card section-placeholder" aria-labelledby="live-empty-title">
          <div className="section-copy">
            <p className="section-eyebrow">No live source</p>
            <h1 id="live-empty-title">Live feed is unavailable</h1>
            <p>Check the machine connection and refresh the live feed.</p>
          </div>
        </section>
      )}

      <section className="section-card live-controls-card" aria-label="Live feed controls">
        <div className="live-filter-group" role="group" aria-label="Filter sensors by status">
          {statusFilters.map((status) => (
            <button
              key={status}
              className={`trend-mode-button ${statusFilter === status ? 'is-selected' : ''}`}
              type="button"
              aria-pressed={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="live-refresh">
          <span>Last update {machine?.lastUpdated ? formatLiveDateTime(machine.lastUpdated) : 'not available'}</span>
          <button className="btn btn-secondary table-action-button" type="button" disabled={isRefreshing} onClick={() => loadLiveFeed({ silent: true })}>
            <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </section>

      <section className="live-sensor-grid" aria-label="Five inductive proximity sensor statuses">
        {filteredSensors.length === 0 ? (
          <section className="section-card section-placeholder" aria-labelledby="live-filter-empty-title">
            <div className="section-copy">
              <p className="section-eyebrow">No matching sensors</p>
              <h1 id="live-filter-empty-title">No sensors match this filter</h1>
              <p>Try another status filter or refresh the live feed.</p>
            </div>
          </section>
        ) : (
          filteredSensors.map((sensor) => (
            <article key={sensor.id} className={`machine-card live-sensor-card ${getLiveStatusClass(sensor.status)}`}>
              <div className="machine-card-header">
                <div>
                  <p className="machine-id">{sensor.sensorCode}</p>
                  <h3>{getSensorLabel(sensor.sensorCode, sensor.label)}</h3>
                </div>
                <span className={`status-badge ${getLiveStatusClass(sensor.status)}`}>
                  <StatusIcon status={sensor.status} />
                  {sensor.status}
                </span>
              </div>

              <dl className="machine-meta live-sensor-meta">
                <div>
                  <dt>Signal</dt>
                  <dd>{formatSignal(sensor.signal)}</dd>
                </div>
                <div>
                  <dt>Last Event</dt>
                  <dd>{formatLiveDateTime(sensor.lastEventAt)}</dd>
                </div>
              </dl>

              <div className="live-purpose-row">
                {sensor.status === 'Downtime' ? <Wrench size={16} aria-hidden="true" /> : <Activity size={16} aria-hidden="true" />}
                <span>{sensor.purpose}</span>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
