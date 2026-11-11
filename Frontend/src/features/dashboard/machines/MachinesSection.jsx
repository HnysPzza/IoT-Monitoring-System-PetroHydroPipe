import './machines.css'
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOutletContext } from 'react-router'
import { Activity, AlertTriangle, CircleCheck, Cpu, LayoutGrid, List, MapPin, RotateCw } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import UpdatedAgo from '../../../shared/components/UpdatedAgo.jsx'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getMachineStatusClass, getSensorStatusClass } from '../../../shared/utils/statusClasses.js'
import { connectivityLabel } from '../live/livePresentation.js'
import { useLiveFeedStream } from '../live/useLiveFeedStream.js'
import { getOperationalSettings } from '../settings/settingsService.js'

function formatTriggerLimit(sensorCode, settingsPayload) {
  const threshold = settingsPayload?.settings?.sensorThresholds?.[sensorCode]
  if (!threshold) return 'Unavailable'
  const outputSensorCode = settingsPayload?.constraints?.outputSensorCode || 'S-05'
  if (sensorCode === outputSensorCode) return 'Not applicable'
  if (!threshold.absenceDetectionEnabled) return 'Disabled'
  const triggerSeconds = Number(threshold.triggerSeconds)
  if (!Number.isFinite(triggerSeconds) || triggerSeconds <= 0) return 'Unavailable'
  if (triggerSeconds % 60 === 0) return `${triggerSeconds / 60} min`
  return `${triggerSeconds}s`
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
  const { token } = useAuth()
  const outlet = useOutletContext()
  const fallbackStream = useLiveFeedStream(outlet?.liveFeed ? null : token)
  const liveFeed = outlet?.liveFeed || fallbackStream

  useLayoutEffect(() => {
    const slot = document.getElementById('machines-header-controls')
    if (slot !== headerSlot) setHeaderSlot(slot)
  })

  const machine = liveFeed.machine
  const sensors = liveFeed.sensors
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
  const runningCount = sensors.filter((sensor) => sensor.status === 'Running').length
  const idleCount = sensors.filter((sensor) => sensor.status === 'Idle').length

  const refreshSnapshot = () => {
    if (machine?.id) void settingsQuery.refetch()
    return liveFeed.reload()
  }

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

  const resolvedHeaderSlot = headerSlot?.isConnected ? headerSlot : document.getElementById('machines-header-controls')
  const headerControls = (
    <div className="machines-header-controls">
      <h2 id="machine-admin-title">{machine.name}</h2><span className="machines-header-code machines-mono">{machine.machineCode}</span>
      <span className={`status-badge ${getMachineStatusClass(machine.status)}`}>{machine.status}</span>
      <button className="icon-button machines-refresh" type="button" aria-label="Refresh machines" title="Refresh machines" disabled={isRefreshing} onClick={refreshSnapshot}>
        <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
      </button>
    </div>
  )

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
            {' '}(updated <UpdatedAgo updatedAt={lastUpdated} />). {error}
          </span>
          <button className="btn btn-secondary table-action-button" type="button" onClick={refreshSnapshot}>Retry machines</button>
        </div>
      ) : null}

      {resolvedHeaderSlot ? createPortal(headerControls, resolvedHeaderSlot) : headerControls}
      <section className="machines-telemetry-strip" aria-label="Machine status summary">
        <div><div><span>Machine code</span><strong className="machines-mono">{machine.machineCode}</strong></div><Cpu size={16} aria-hidden="true" /></div>
        <div><div><span>Location</span><strong>{machine.location || 'Not set'}</strong></div><MapPin size={16} aria-hidden="true" /></div>
        <div><div><span>Sensors configured</span><strong>{sensorCountLabel}</strong><small>{runningCount} running · {idleCount} idle</small></div><Activity size={16} aria-hidden="true" /></div>
        <div><div><span>Status snapshot</span><strong><time dateTime={capturedAt || undefined}>{formatShortDateTime(capturedAt)}</time></strong></div><CircleCheck size={16} aria-hidden="true" /></div>
      </section>

      <section className="machines-sensors-section" aria-labelledby="sensor-admin-title">
        <div className="machines-section-heading">
          <h2 id="sensor-admin-title">Inductive proximity sensors <span className="machines-count">{sensors.length} configured</span></h2>
          <div className="machines-view-toggle" role="group" aria-label="Sensor view">
            <button type="button" aria-label="Grid view" aria-pressed={sensorView === 'grid'} onClick={() => setSensorView('grid')}><LayoutGrid size={16} aria-hidden="true" /></button>
            <button type="button" aria-label="Table view" aria-pressed={sensorView === 'table'} onClick={() => setSensorView('table')}><List size={16} aria-hidden="true" /></button>
          </div>
        </div>

        {sensors.length === 0 ? <p className="table-muted">No sensors were returned by the live monitoring source.</p> : sensorView === 'table' ? (
          <div className="account-table-wrap"><table className="account-table machines-sensor-table"><thead><tr><th scope="col">Sensor</th><th scope="col">Status</th><th scope="col">Hardware</th><th scope="col">Connection</th><th scope="col">Last event</th></tr></thead><tbody>
            {sensors.map((sensor) => <tr key={sensor.id}><td>{sensor.sensorCode} · {getSensorLabel(sensor.sensorCode, sensor.label)}</td><td><span className={`status-badge ${getSensorStatusClass(sensor.status)}`}>{sensor.status}</span></td><td>{sensor.esp32DeviceId || 'Unavailable'}</td><td><span className={`machines-connection-${connectivityLabel(sensor) === 'Connected' ? 'connected' : 'unavailable'}`}>{connectivityLabel(sensor)}</span></td><td>{formatShortDateTime(sensor.lastEventAt, 'No event yet')}</td></tr>)}
          </tbody></table></div>
        ) : (
          <div className="admin-sensor-grid">
            {sensors.map((sensor) => {
              const statusClass = getSensorStatusClass(sensor.status)
              return (
                <article key={sensor.id} className={`machine-card admin-sensor-card ${statusClass}`}>
                  <div className="machines-sensor-heading">
                    <span className="machines-sensor-code">{sensor.sensorCode}</span>
                    <span className={`status-badge ${statusClass}`}>{sensor.status}</span>
                  </div>
                  <div className="machines-sensor-identity">
                    <h3>{getSensorLabel(sensor.sensorCode, sensor.label)}</h3>
                    <p>{getSensorPurpose(sensor.sensorCode, sensor.purpose)}</p>
                  </div>
                  <dl className="machines-sensor-telemetry">
                    <div><dt>Connection</dt><dd className={`machines-connection-${connectivityLabel(sensor) === 'Connected' ? 'connected' : 'unavailable'}`}>{connectivityLabel(sensor)}</dd></div>
                    <div><dt>Trigger limit</dt><dd>{formatTriggerLimit(sensor.sensorCode, settingsQuery.data)}</dd></div>
                  </dl>
                  <dl className="machines-sensor-footer">
                    <div><dt>Hardware</dt><dd>{sensor.esp32DeviceId || 'Unavailable'}</dd></div>
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
