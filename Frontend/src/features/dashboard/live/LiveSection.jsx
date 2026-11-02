import './live.css'
import { useMemo } from 'react'
import { useOutletContext } from 'react-router'
import { Activity, AlertTriangle, CheckCircle2, PauseCircle, RotateCw, WifiOff, Wrench } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { formatLiveDateTime } from '../../../shared/utils/formatters.js'
import { formatSignal } from '../../../shared/utils/signalFormatters.js'
import { getLiveStatusClass, getSensorStatusClass } from '../../../shared/utils/statusClasses.js'
import { getProcessIdleBanner, presentLiveSensors } from './livePresentation.js'
import { useLiveFeedStream } from './useLiveFeedStream.js'

const RELATIVE_TIME_UNITS = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en-PH', { numeric: 'auto' })

function StatusIcon({ status }) {
  if (status === 'Running') return <Activity size={18} aria-hidden="true" />
  if (status === 'Downtime') return <AlertTriangle size={18} aria-hidden="true" />
  if (status === 'Fault') return <Wrench size={18} aria-hidden="true" />
  return <PauseCircle size={18} aria-hidden="true" />
}

function formatEventAge(value) {
  if (!value) return 'No event yet'
  const difference = Date.parse(value) - Date.now()
  if (!Number.isFinite(difference)) return 'Unknown'
  const [unit, duration] =
    RELATIVE_TIME_UNITS.find(([, unitDuration]) => Math.abs(difference) >= unitDuration) ||
    RELATIVE_TIME_UNITS[RELATIVE_TIME_UNITS.length - 1]
  return RELATIVE_TIME_FORMATTER.format(Math.round(difference / duration), unit)
}

export default function LiveSection() {
  const { token } = useAuth()
  const outlet = useOutletContext()
  const fallbackStream = useLiveFeedStream(outlet?.liveFeed ? null : token)
  const liveFeed = outlet?.liveFeed || fallbackStream

  const machine = liveFeed.machine
  const sensors = liveFeed.sensors
  const monitoring = liveFeed.monitoring
  const isLoading = liveFeed.isLoading
  const isRefreshing = liveFeed.isRefreshing
  const notice = liveFeed.error ? {
    type: 'error',
    message: Boolean(liveFeed.machine)
      ? `Live data is stale. ${liveFeed.error}`
      : liveFeed.error,
  } : null

  const presentedSensors = useMemo(
    () => presentLiveSensors(sensors, monitoring.mode),
    [sensors, monitoring.mode],
  )
  const processIdleBanner = useMemo(
    () => getProcessIdleBanner(presentedSensors, monitoring.mode),
    [presentedSensors, monitoring.mode],
  )

  if (isLoading && !machine) {
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
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{notice.message}</span>
        </div>
      ) : null}
      {processIdleBanner ? (
        <div className="notice dashboard-alert overview-alert-banner notice-idle" role="status" aria-live="polite">
          <div className="overview-alert-lead">
            <PauseCircle size={16} aria-hidden="true" className="overview-alert-icon" />
            <span className="overview-alert-message">{processIdleBanner.message}</span>
          </div>
          {processIdleBanner.extraCount > 0 ? (
            <span className="overview-alert-count">
              +{processIdleBanner.extraCount} more idle sensor{processIdleBanner.extraCount > 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
      ) : null}

      {machine ? (
        <section className="section-card live-hero-card" aria-labelledby="live-title">
          <div className="section-heading">
            <div><h2 id="live-title">{machine.name}</h2></div>
            <div className="live-heading-badges">
              <button
                className="icon-button live-refresh-icon"
                type="button"
                aria-label="Refresh live feed"
                disabled={isRefreshing}
                onClick={() => liveFeed.reload()}
              >
                <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={18} strokeWidth={2.4} aria-hidden="true" />
              </button>
              <span className="status-badge status-inactive">Watchdog {monitoring.mode}</span>
              <span className={`status-badge ${getLiveStatusClass(machine.status)}`}>
                <StatusIcon status={machine.status} />
                {machine.status}
              </span>
            </div>
          </div>
          <div className="live-machine-grid">
            <div><span className="live-metric-label">Machine</span><strong>{machine.machineCode}</strong></div>
            <div><span className="live-metric-label">Location</span><strong>{machine.location || 'Not set'}</strong></div>
            <div><span className="live-metric-label">Status snapshot</span><strong>{formatLiveDateTime(monitoring.capturedAt, 'Not available')}</strong></div>
            <div><span className="live-metric-label">Running sensors</span><strong>{machine.activeSensors}</strong></div>
          </div>
        </section>
      ) : (
        <section className="section-card section-placeholder" aria-labelledby="live-empty-title">
          <div className="section-copy">
            <p className="section-eyebrow">No live source</p>
            <h2 id="live-empty-title">Live feed is unavailable</h2>
            <p>Check the machine connection and refresh the live feed.</p>
          </div>
        </section>
      )}

      <section className="live-sensor-grid" aria-label="Five inductive proximity sensor statuses">
        {presentedSensors.length === 0 ? (
          <section className="section-card section-placeholder" aria-labelledby="live-sensors-empty-title">
            <div className="section-copy">
              <p className="section-eyebrow">No live sensors</p>
              <h2 id="live-sensors-empty-title">Sensor data is unavailable</h2>
              <p>Refresh the live feed to try again.</p>
            </div>
          </section>
        ) : presentedSensors.map((sensor) => (
          <article key={sensor.id} className={`machine-card live-sensor-card ${getSensorStatusClass(sensor.displayStatus)}`}>
            <div className="machine-card-header">
              <div>
                <p className="machine-id">{sensor.sensorCode}</p>
                <h3>{getSensorLabel(sensor.sensorCode, sensor.label)}</h3>
              </div>
              <span className={`status-badge ${getSensorStatusClass(sensor.displayStatus)}`}>
                <StatusIcon status={sensor.displayStatus} />
                {sensor.displayStatus}
              </span>
            </div>
            <p className="live-detection-state">{sensor.stateLabel}</p>
            <dl className="machine-meta live-sensor-meta">
              <div>
                <dt>Signal</dt>
                <dd>{formatSignal(sensor.signal)}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd className={sensor.monitoring?.connectivityState === 'offline' ? 'live-offline' : ''}>
                  {sensor.monitoring?.connectivityState === 'online' ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
                  {sensor.monitoring?.connectivityState === 'offline' ? <WifiOff size={14} aria-hidden="true" /> : null}
                  <span className="live-connectivity-label">{sensor.connectivityLabel}</span>
                </dd>
              </div>
            </dl>
            <div className="live-purpose-row">
              <span>{getSensorPurpose(sensor.sensorCode, sensor.purpose)}</span>
            </div>
          </article>
        ))}
      </section>

      {presentedSensors.length > 0 ? (
        <section className="section-card live-activity-card" aria-labelledby="live-activity-title">
          <div className="live-activity-heading">
            <div><h2 id="live-activity-title">Latest event by sensor</h2></div>

          </div>
          <ol className="live-activity-grid" aria-label="Latest event reported by each sensor">
            {presentedSensors.map((sensor) => (
              <li className="live-activity-item" key={sensor.id}>
                <div className="live-activity-sensor">
                  <span className="machine-id">{sensor.sensorCode}</span>
                  <strong>{getSensorLabel(sensor.sensorCode, sensor.label)}</strong>
                </div>
                <div className="live-activity-time">
                  <span>{formatEventAge(sensor.lastEventAt)}</span>
                  {sensor.lastEventAt ? <time dateTime={sensor.lastEventAt}>{formatLiveDateTime(sensor.lastEventAt)}</time> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}
