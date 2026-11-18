import './machines.css'
import Status from '../../../shared/components/Status.jsx'
import { useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useOutletContext } from 'react-router'
import { Activity, AlertTriangle, CircleCheck, Cpu, LayoutGrid, List, MapPin, RotateCw, SlidersHorizontal, WifiOff } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import UpdatedAgo from '../../../shared/components/UpdatedAgo.jsx'
import { canAccessDashboardRoute } from '../../../shared/constants/dashboardMeta.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getSensorStatusClass } from '../../../shared/utils/statusClasses.js'
import { connectivityLabel, formatSensorStatusSummary, presentLiveSensors, summarizeSensorStatuses } from '../live/livePresentation.js'
import { useLiveFeedStream } from '../live/useLiveFeedStream.js'
import { getOperationalSettings } from '../settings/settingsService.js'

function formatTriggerLimit(sensorCode, settingsPayload) {
  const threshold = settingsPayload?.settings?.sensorThresholds?.[sensorCode]
  if (!threshold) return 'Unavailable'
  const outputSensorCode = settingsPayload?.constraints?.outputSensorCode || 'S-05'
  if (sensorCode === outputSensorCode) return 'N/A'
  if (!threshold.absenceDetectionEnabled) return 'Disabled'
  const triggerSeconds = Number(threshold.triggerSeconds)
  if (!Number.isFinite(triggerSeconds) || triggerSeconds <= 0) return 'Unavailable'
  if (triggerSeconds % 60 === 0) return `${triggerSeconds / 60} min`
  return `${triggerSeconds}s`
}

function getConnectionClass(label) {
  if (label === 'Connected') return 'machines-connection-connected'
  if (label === 'Offline') return 'machines-connection-offline'
  return 'machines-connection-unavailable'
}

function ConnectionValue({ label }) {
  if (label === 'Offline') {
    return (
      <>
        <WifiOff size={14} aria-hidden="true" />
        {' '}
        Offline
      </>
    )
  }

  return label
}

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
  const [sensorView, setSensorView] = useState('grid')
  const [headerSlot, setHeaderSlot] = useState(() => document.getElementById('machines-header-controls'))
  const { token, user } = useAuth()
  const canConfigureSettings = canAccessDashboardRoute(user?.role, '/dashboard/settings')
  const outlet = useOutletContext()
  const fallbackStream = useLiveFeedStream(outlet?.liveFeed ? null : token)
  const liveFeed = outlet?.liveFeed || fallbackStream

  useLayoutEffect(() => {
    const slot = document.getElementById('machines-header-controls')
    if (slot !== headerSlot) setHeaderSlot(slot)
  }, [])

  const machine = liveFeed.machine
  const rawSensors = liveFeed.sensors
  const monitoringMode = liveFeed.monitoring?.mode
  const sensors = useMemo(
    () => presentLiveSensors(rawSensors, monitoringMode).map((sensor) => ({
      ...sensor,
      operationalStatus: sensor.operationalStatus ?? sensor.status,
      status: sensor.displayStatus || sensor.status,
    })),
    [rawSensors, monitoringMode],
  )
  const settingsQuery = useAuthenticatedQuery({
    queryKey: queryKeys.settings.machine(machine?.id || null),
    queryFn: ({ token: currentToken, signal }) => getOperationalSettings(currentToken, machine.id, signal),
    enabled: Boolean(machine?.id),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  })
  const capturedAt = liveFeed.monitoring?.capturedAt || null
  const requestState = liveFeed.state
  const error = liveFeed.error
  const lastUpdated = liveFeed.lastUpdated
  const isRefreshing = liveFeed.isRefreshing
  const sensorCountLabel = `${sensors.length} sensor${sensors.length === 1 ? '' : 's'}`
  const sensorSummary = summarizeSensorStatuses(sensors)
  const sensorSummaryLabel = formatSensorStatusSummary(sensorSummary)

  const refreshSnapshot = () => {
    if (machine?.id) void settingsQuery.refetch()
    return liveFeed.reload()
  }

  if (requestState === 'loading' && !machine) {
    return (
      <div className="machines-layout" role="status" aria-live="polite">
        <h1 className="sr-only">Machines</h1>
        <span className="sr-only">Loading live machine status...</span>
        <section className="machines-telemetry-strip" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="machines-skeleton-strip-cell">
              <div className="skeleton machines-skeleton-label" />
              <div className="skeleton machines-skeleton-value" />
            </div>
          ))}
        </section>
        <section className="machines-sensors-section" aria-hidden="true">
          <div className="machines-section-heading">
            <div className="skeleton machines-skeleton-heading" />
            <div className="skeleton machines-skeleton-toggle" />
          </div>
          <div className="admin-sensor-grid">
            {Array.from({ length: 5 }).map((_, index) => (
              <article key={index} className="machine-card admin-sensor-card">
                <div className="machines-sensor-heading">
                  <div className="skeleton machines-skeleton-code" />
                  <div className="skeleton machines-skeleton-status" />
                </div>
                <div className="skeleton machines-skeleton-title" />
                <div className="skeleton machines-skeleton-meta" />
                <div className="skeleton machines-skeleton-footer" />
              </article>
            ))}
          </div>
        </section>
      </div>
    )
  }

  if (requestState === 'error' && !machine) {
    return (
      <div className="machines-layout">
        <h1 className="sr-only">Machines</h1>
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
    return (
      <div className="machines-layout">
        <h1 className="sr-only">Machines</h1>
        <EmptyMachinesState isRefreshing={isRefreshing} onRefresh={refreshSnapshot} />
      </div>
    )
  }

  const resolvedHeaderSlot = headerSlot?.isConnected ? headerSlot : document.getElementById('machines-header-controls')
  const headerControls = (
    <div className="machines-header-controls">
      <h2 id="machine-admin-title">{machine.name}</h2>
      <Status>{machine.status}</Status>
      <button
        className="icon-button machines-refresh"
        type="button"
        aria-label="Refresh machines"
        aria-busy={isRefreshing}
        title="Refresh machines"
        disabled={isRefreshing}
        onClick={refreshSnapshot}
      >
        <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
      </button>
    </div>
  )

  return (
    <div className="machines-layout">
      <h1 className="sr-only">Machines</h1>
      <span className="sr-only" role="status" aria-live="polite">
        {isRefreshing ? 'Refreshing live machine status.' : ''}
      </span>
      {requestState === 'stale' ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Live machine status is stale. Showing the last successful result from{' '}
            <time dateTime={lastUpdated?.toISOString()}>
              {lastUpdated ? formatSuccessfulUpdate(lastUpdated) : 'an earlier update'}
            </time>
            {' '}(updated <UpdatedAgo updatedAt={lastUpdated} />). {error}
          </span>
          <button className="btn btn-secondary table-action-button" type="button" onClick={refreshSnapshot}>Retry machines</button>
        </div>
      ) : null}

      {resolvedHeaderSlot ? createPortal(headerControls, resolvedHeaderSlot) : headerControls}
      <section className="machines-telemetry-strip" aria-label="Machine status summary">
        <div><div><span>Machine code</span><strong className="machines-mono">{machine.machineCode}</strong></div><Cpu size={16} aria-hidden="true" /></div>
        <div><div><span>Location</span><strong>{machine.location || 'Not set'}</strong></div><MapPin size={16} aria-hidden="true" /></div>
        <div><div><span>Sensors configured</span><strong>{sensorCountLabel}</strong><small>{sensorSummaryLabel}</small></div><Activity size={16} aria-hidden="true" /></div>
        <div><div><span>Status snapshot</span><strong><time dateTime={capturedAt || undefined}>{formatShortDateTime(capturedAt)}</time></strong></div><CircleCheck size={16} aria-hidden="true" /></div>
      </section>

      <section className="machines-sensors-section" aria-labelledby="sensor-admin-title">
        <div className="machines-section-heading">
          <h2 id="sensor-admin-title">Inductive proximity sensors <span className="machines-count">{sensors.length} configured</span></h2>
          <div className="machines-section-actions">
            {canConfigureSettings ? (
              <Link className="btn btn-secondary machines-settings-link" to="/dashboard/settings">
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span>Configure thresholds</span>
              </Link>
            ) : null}
            <div className="machines-view-toggle" role="group" aria-label="Sensor view">
              <button type="button" aria-label="Grid view" aria-pressed={sensorView === 'grid'} onClick={() => setSensorView('grid')}><LayoutGrid size={16} aria-hidden="true" /></button>
              <button type="button" aria-label="Table view" aria-pressed={sensorView === 'table'} onClick={() => setSensorView('table')}><List size={16} aria-hidden="true" /></button>
            </div>
          </div>
        </div>

        {sensors.length === 0 ? <p className="table-muted">No sensors were returned by the live monitoring source.</p> : sensorView === 'table' ? (
          <div className="account-table-wrap">
            <table className="account-table machines-sensor-table">
              <thead>
                <tr>
                  <th scope="col">Sensor</th>
                  <th scope="col">Status</th>
                  <th scope="col">Trigger limit</th>
                  <th scope="col">Hardware</th>
                  <th scope="col">Connection</th>
                  <th scope="col">Last event</th>
                </tr>
              </thead>
              <tbody>
                {sensors.map((sensor) => {
                  const connection = connectivityLabel(sensor)
                  return (
                    <tr key={sensor.id}>
                      <td data-label="Sensor">
                        <div className="machines-table-sensor">
                          <span className="machines-table-sensor-name">{sensor.sensorCode} · {getSensorLabel(sensor.sensorCode, sensor.label)}</span>
                          <span className="machines-table-sensor-purpose">{getSensorPurpose(sensor.sensorCode, sensor.purpose)}</span>
                        </div>
                      </td>
                      <td data-label="Status"><Status>{sensor.status}</Status></td>
                      <td data-label="Trigger limit">{formatTriggerLimit(sensor.sensorCode, settingsQuery.data)}</td>
                      <td data-label="Hardware"><span className="machines-hardware-code machines-mono">{sensor.esp32DeviceId || 'Unavailable'}</span></td>
                      <td data-label="Connection"><span className={`machines-connection ${getConnectionClass(connection)}`}><ConnectionValue label={connection} /></span></td>
                      <td data-label="Last event">{formatShortDateTime(sensor.lastEventAt, 'No event yet')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-sensor-grid">
            {sensors.map((sensor) => {
              const statusClass = getSensorStatusClass(sensor.status)
              const connection = connectivityLabel(sensor)
              return (
                <article key={sensor.id} className={`machine-card admin-sensor-card ${statusClass}`}>
                  <div className="machines-sensor-heading">
                    <span className="machines-sensor-code">{sensor.sensorCode}</span>
                    <Status>{sensor.status}</Status>
                  </div>
                  <div className="machines-sensor-identity">
                    <h3>{getSensorLabel(sensor.sensorCode, sensor.label)}</h3>
                    <p>{getSensorPurpose(sensor.sensorCode, sensor.purpose)}</p>
                  </div>
                  <dl className="machines-sensor-telemetry">
                    <div><dt>Connection</dt><dd className={`machines-connection ${getConnectionClass(connection)}`}><ConnectionValue label={connection} /></dd></div>
                    <div><dt>Trigger limit</dt><dd>{formatTriggerLimit(sensor.sensorCode, settingsQuery.data)}</dd></div>
                  </dl>
                  <dl className="machines-sensor-footer">
                    <div><dt>Hardware</dt><dd className="machines-hardware-code machines-mono">{sensor.esp32DeviceId || 'Unavailable'}</dd></div>
                    <div><dt>Last event</dt><dd>{formatShortDateTime(sensor.lastEventAt, 'No event yet')}</dd></div>
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
