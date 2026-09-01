import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Cpu, Factory, MapPin, RadioTower, RotateCw } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getMachineStatusClass, getSensorStatusClass } from '../../../shared/utils/statusClasses.js'
import { getMachines, getMachineSensors, updateMachineStatus, updateSensorStatus } from './machinesService.js'

const machineStatuses = ['Running', 'Idle', 'Downtime']
const sensorStatuses = ['Active', 'Inactive', 'Fault']

function EmptyMachinesState({ isRefreshing = false, onRefresh }) {
  return (
    <section className="section-card section-placeholder" aria-labelledby="machines-empty-title">
      <div className="section-copy">
        <p className="section-eyebrow">No records</p>
        <h2 id="machines-empty-title">No machines found</h2>
        <p>Add Spiral Mill 01 and its five sensors to manage machine setup here.</p>
        <button className="btn btn-success" type="button" aria-label="Refresh machines" disabled={isRefreshing} onClick={onRefresh}>
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

function getRequestDisplayState({ state, hasCurrentData, errorKey, currentKey }) {
  if (state === 'error') {
    return errorKey === currentKey ? 'error' : 'loading'
  }

  return hasCurrentData ? state : 'loading'
}

export default function MachinesSection() {
  const { token } = useAuth()
  const [machines, setMachines] = useState([])
  const [selectedMachineId, setSelectedMachineId] = useState('')
  const [sensors, setSensors] = useState([])
  const [notice, setNotice] = useState(null)
  const [machinesState, setMachinesState] = useState('loading')
  const [machinesRequestKey, setMachinesRequestKey] = useState('')
  const [machinesError, setMachinesError] = useState('')
  const [machinesErrorKey, setMachinesErrorKey] = useState('')
  const [machinesLastUpdated, setMachinesLastUpdated] = useState(null)
  const [machinesRefresh, setMachinesRefresh] = useState(0)
  const machinesRequestIdRef = useRef(0)
  const successfulMachinesRef = useRef(null)
  const [sensorsState, setSensorsState] = useState('loading')
  const [sensorsRequestKey, setSensorsRequestKey] = useState('')
  const [sensorsError, setSensorsError] = useState('')
  const [sensorsErrorKey, setSensorsErrorKey] = useState('')
  const [sensorsLastUpdated, setSensorsLastUpdated] = useState(null)
  const [sensorsRefresh, setSensorsRefresh] = useState(0)
  const sensorsRequestIdRef = useRef(0)
  const successfulSensorsRef = useRef(null)
  const [pendingOperations, setPendingOperations] = useState({})
  const [recoveryOverrideSensor, setRecoveryOverrideSensor] = useState(null)
  const [recoveryOverrideReason, setRecoveryOverrideReason] = useState('')
  const mutationIdRef = useRef(0)
  const latestMutationByEntityRef = useRef(new Map())

  const machinesKey = `${token || 'anonymous'}:machines`
  const hasCurrentMachines = machinesRequestKey === machinesKey
  const selectedMachine = useMemo(() => {
    if (!hasCurrentMachines) return null
    return machines.find((machine) => machine.id === selectedMachineId) || machines[0] || null
  }, [hasCurrentMachines, machines, selectedMachineId])
  const sensorsKey = selectedMachine?.id ? `${token || 'anonymous'}:machine:${selectedMachine.id}:sensors` : ''
  const hasCurrentSensors = Boolean(sensorsKey) && sensorsRequestKey === sensorsKey
  const machinesDisplayState = getRequestDisplayState({
    state: machinesState,
    hasCurrentData: hasCurrentMachines,
    errorKey: machinesErrorKey,
    currentKey: machinesKey,
  })
  const sensorsDisplayState = getRequestDisplayState({
    state: sensorsState,
    hasCurrentData: hasCurrentSensors,
    errorKey: sensorsErrorKey,
    currentKey: sensorsKey,
  })
  const currentContextRef = useRef(null)
  currentContextRef.current = {
    token,
    machinesKey,
    sensorsKey,
    selectedMachineId: selectedMachine?.id || '',
    machineIds: machines.map((machine) => machine.id),
    sensorIds: sensors.map((sensor) => sensor.id),
  }

  useEffect(() => {
    setPendingOperations({})
    setNotice(null)
    setRecoveryOverrideSensor(null)
    setRecoveryOverrideReason('')
  }, [token])

  useEffect(() => {
    const requestId = machinesRequestIdRef.current + 1
    machinesRequestIdRef.current = requestId
    let isCancelled = false

    async function loadMachines() {
      setMachinesState('loading')
      setMachinesError('')

      try {
        const payload = await getMachines(token)
        if (isCancelled || requestId !== machinesRequestIdRef.current) return

        const nextMachines = payload.machines || []
        const updatedAt = new Date()
        successfulMachinesRef.current = { requestKey: machinesKey, data: nextMachines, updatedAt }
        setMachines(nextMachines)
        setMachinesRequestKey(machinesKey)
        setMachinesLastUpdated(updatedAt)
        setSelectedMachineId((current) => (
          nextMachines.some((machine) => machine.id === current) ? current : nextMachines[0]?.id || ''
        ))
        setMachinesState(nextMachines.length ? 'success' : 'empty')
      } catch (error) {
        if (isCancelled || requestId !== machinesRequestIdRef.current) return

        setMachinesError(error.message || 'Unable to load machines.')
        setMachinesErrorKey(machinesKey)
        if (successfulMachinesRef.current?.requestKey === machinesKey) {
          setMachines(successfulMachinesRef.current.data)
          setMachinesRequestKey(machinesKey)
          setMachinesLastUpdated(successfulMachinesRef.current.updatedAt)
          setMachinesState('stale')
        } else {
          setMachinesState('error')
        }
      }
    }

    loadMachines()

    return () => {
      isCancelled = true
    }
  }, [machinesKey, machinesRefresh, token])

  useEffect(() => {
    const requestId = sensorsRequestIdRef.current + 1
    sensorsRequestIdRef.current = requestId
    let isCancelled = false

    async function loadSensors() {
      if (!hasCurrentMachines || !selectedMachine?.id) {
        setSensors([])
        setSensorsRequestKey('')
        setSensorsState(hasCurrentMachines ? 'empty' : 'loading')
        return
      }

      setSensorsState('loading')
      setSensorsError('')

      try {
        const payload = await getMachineSensors(token, selectedMachine.id)
        if (isCancelled || requestId !== sensorsRequestIdRef.current) return

        const nextSensors = payload.sensors || []
        const updatedAt = new Date()
        successfulSensorsRef.current = { requestKey: sensorsKey, data: nextSensors, updatedAt }
        setSensors(nextSensors)
        setSensorsRequestKey(sensorsKey)
        setSensorsLastUpdated(updatedAt)
        setSensorsState(nextSensors.length ? 'success' : 'empty')
      } catch (error) {
        if (isCancelled || requestId !== sensorsRequestIdRef.current) return

        setSensorsError(error.message || 'Unable to load machine sensors.')
        setSensorsErrorKey(sensorsKey)
        if (successfulSensorsRef.current?.requestKey === sensorsKey) {
          setSensors(successfulSensorsRef.current.data)
          setSensorsRequestKey(sensorsKey)
          setSensorsLastUpdated(successfulSensorsRef.current.updatedAt)
          setSensorsState('stale')
        } else {
          setSensorsState('error')
        }
      }
    }

    loadSensors()

    return () => {
      isCancelled = true
    }
  }, [hasCurrentMachines, selectedMachine?.id, sensorsKey, sensorsRefresh, token])

  async function handleMachineStatusChange(status) {
    if (!selectedMachine) return

    const entityId = selectedMachine.id
    const operationKey = `machine-${entityId}`
    const operationId = mutationIdRef.current + 1
    mutationIdRef.current = operationId
    latestMutationByEntityRef.current.set(operationKey, operationId)
    setPendingOperations((current) => ({
      ...current,
      [operationKey]: { operationId, contextKey: machinesKey },
    }))
    setNotice(null)

    const isCurrentOperation = () => {
      const context = currentContextRef.current
      return latestMutationByEntityRef.current.get(operationKey) === operationId
        && context.token === token
        && context.machinesKey === machinesKey
        && context.selectedMachineId === entityId
        && context.machineIds.includes(entityId)
    }

    try {
      const payload = await updateMachineStatus(token, entityId, status)
      if (!isCurrentOperation()) return

      setMachines((current) => {
        const nextMachines = current.map((machine) => (machine.id === payload.machine.id ? payload.machine : machine))
        if (successfulMachinesRef.current?.requestKey === machinesKey) {
          successfulMachinesRef.current.data = nextMachines
        }
        return nextMachines
      })
      if (isCurrentOperation()) {
        setNotice({ type: 'success', message: `${payload.machine.name} is now ${payload.machine.status}.` })
      }
    } catch (error) {
      if (isCurrentOperation()) {
        setNotice({ type: 'error', message: error.message || 'Unable to update machine status.' })
      }
    } finally {
      if (latestMutationByEntityRef.current.get(operationKey) === operationId) {
        latestMutationByEntityRef.current.delete(operationKey)
        setPendingOperations((current) => {
          if (current[operationKey]?.operationId !== operationId) return current
          const next = { ...current }
          delete next[operationKey]
          return next
        })
      }
    }
  }

  async function handleSensorStatusChange(sensor, status, overrideReason) {
    const entityId = sensor.id
    const operationKey = `sensor-${entityId}`
    const operationId = mutationIdRef.current + 1
    mutationIdRef.current = operationId
    latestMutationByEntityRef.current.set(operationKey, operationId)
    setPendingOperations((current) => ({
      ...current,
      [operationKey]: { operationId, contextKey: sensorsKey },
    }))
    setNotice(null)

    const isCurrentOperation = () => {
      const context = currentContextRef.current
      return latestMutationByEntityRef.current.get(operationKey) === operationId
        && context.token === token
        && context.sensorsKey === sensorsKey
        && context.sensorIds.includes(entityId)
    }

    try {
      const payload = await updateSensorStatus(token, entityId, status, overrideReason)
      if (!isCurrentOperation()) return false

      setSensors((current) => {
        const nextSensors = current.map((item) => (item.id === payload.sensor.id ? payload.sensor : item))
        if (successfulSensorsRef.current?.requestKey === sensorsKey) {
          successfulSensorsRef.current.data = nextSensors
        }
        return nextSensors
      })
      if (payload.machine) {
        setMachines((current) => {
          const nextMachines = current.map((machine) => (machine.id === payload.machine.id ? payload.machine : machine))
          if (successfulMachinesRef.current?.requestKey === machinesKey) {
            successfulMachinesRef.current.data = nextMachines
          }
          return nextMachines
        })
      }
      if (isCurrentOperation()) {
        const recoveryMessage = payload.recoveryOverride?.alertAction === 'updated'
          ? `${getSensorLabel(payload.sensor.sensorCode, payload.sensor.label)} recovery override applied. The alert is waiting for acknowledgement.`
          : payload.recoveryOverride?.alertAction === 'resolved'
            ? `${getSensorLabel(payload.sensor.sensorCode, payload.sensor.label)} recovery override applied. The acknowledged alert is now resolved.`
            : `${getSensorLabel(payload.sensor.sensorCode, payload.sensor.label)} recovery override applied.`
        setNotice({
          type: 'success',
          message: payload.recoveryOverride
            ? recoveryMessage
            : `${getSensorLabel(payload.sensor.sensorCode, payload.sensor.label)} is now ${payload.sensor.status}.`,
        })
      }
      return true
    } catch (error) {
      if (isCurrentOperation()) {
        setNotice({ type: 'error', message: error.message || 'Unable to update sensor status.' })
      }
      return false
    } finally {
      if (latestMutationByEntityRef.current.get(operationKey) === operationId) {
        latestMutationByEntityRef.current.delete(operationKey)
        setPendingOperations((current) => {
          if (current[operationKey]?.operationId !== operationId) return current
          const next = { ...current }
          delete next[operationKey]
          return next
        })
      }
    }
  }

  async function submitRecoveryOverride(event) {
    event.preventDefault()
    if (!recoveryOverrideSensor || !recoveryOverrideReason.trim()) return

    const succeeded = await handleSensorStatusChange(
      recoveryOverrideSensor,
      'Active',
      recoveryOverrideReason.trim(),
    )
    if (succeeded) {
      setRecoveryOverrideSensor(null)
      setRecoveryOverrideReason('')
    }
  }

  if (machinesDisplayState === 'loading' && !hasCurrentMachines) {
    return (
      <div className="machines-layout">
        <section className="section-card" role="status" aria-live="polite">
          <span className="sr-only">Loading machines...</span>
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-panel" />
        </section>
      </div>
    )
  }

  if (machinesDisplayState === 'error') {
    return (
      <div className="machines-layout">
        <section className="section-card section-placeholder" aria-labelledby="machines-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Machine registry unavailable</p>
            <h2 id="machines-error-title">Unable to load machines</h2>
            <p role="alert">{machinesError}</p>
            <button className="btn btn-secondary" type="button" onClick={() => setMachinesRefresh((current) => current + 1)}>
              Retry machines
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (hasCurrentMachines && machines.length === 0) {
    return (
      <div className="machines-layout">
        {machinesState === 'loading' ? (
          <div className="notice dashboard-alert" role="status" aria-live="polite">Refreshing machines...</div>
        ) : null}

        {machinesState === 'stale' ? (
          <div className="notice notice-error dashboard-alert" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              Machine registry data is stale. Showing the last successful result from{' '}
              <time dateTime={machinesLastUpdated?.toISOString()}>
                {machinesLastUpdated ? formatSuccessfulUpdate(machinesLastUpdated) : 'an earlier update'}
              </time>
              . {machinesError}
            </span>
            <button className="btn btn-secondary table-action-button" type="button" onClick={() => setMachinesRefresh((current) => current + 1)}>
              Retry machines
            </button>
          </div>
        ) : null}

        <EmptyMachinesState
          isRefreshing={machinesState === 'loading'}
          onRefresh={() => setMachinesRefresh((current) => current + 1)}
        />
      </div>
    )
  }

  return (
    <div className="machines-layout">
      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      ) : null}

      {machinesState === 'loading' && hasCurrentMachines ? (
        <div className="notice dashboard-alert" role="status" aria-live="polite">Refreshing machines...</div>
      ) : null}

      {machinesState === 'stale' && hasCurrentMachines ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Machine registry data is stale. Showing the last successful result from{' '}
            <time dateTime={machinesLastUpdated?.toISOString()}>
              {machinesLastUpdated ? formatSuccessfulUpdate(machinesLastUpdated) : 'an earlier update'}
            </time>
            . {machinesError}
          </span>
          <button className="btn btn-secondary table-action-button" type="button" onClick={() => setMachinesRefresh((current) => current + 1)}>
            Retry machines
          </button>
        </div>
      ) : null}

      <section className="section-card machine-admin-hero" aria-labelledby="machine-admin-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Machine registry</p>
            <h2 id="machine-admin-title">{selectedMachine.name}</h2>
          </div>
          <button
            className="btn btn-success table-action-button machines-refresh-button"
            type="button"
            aria-label="Refresh machines"
            disabled={machinesState === 'loading'}
            onClick={() => setMachinesRefresh((current) => current + 1)}
          >
            <RotateCw className={machinesState === 'loading' ? 'spin-icon' : ''} size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>

        <div className="machine-admin-grid">
          <article>
            <Factory size={18} aria-hidden="true" />
            <span>Machine Code</span>
            <strong>{selectedMachine.machineCode}</strong>
          </article>
          <article>
            <MapPin size={18} aria-hidden="true" />
            <span>Location</span>
            <strong>{selectedMachine.location || 'Not set'}</strong>
          </article>
          <article>
            <RadioTower size={18} aria-hidden="true" />
            <span>Inductive Sensors</span>
            <strong>{selectedMachine.sensorCount} connected</strong>
          </article>
          <article>
            <Activity size={18} aria-hidden="true" />
            <span>Last Updated</span>
            <strong>{formatShortDateTime(selectedMachine.updatedAt)}</strong>
          </article>
        </div>

        <div className="machine-status-admin">
          <span className={`status-badge ${getMachineStatusClass(selectedMachine.status)}`}>{selectedMachine.status}</span>
          <label className="filter-field" htmlFor={`machine-status-${selectedMachine.id}`}>
            <span>Machine status</span>
            <select
              id={`machine-status-${selectedMachine.id}`}
              name="machineStatus"
              value={selectedMachine.status}
              disabled={
                machinesState !== 'success'
                || pendingOperations[`machine-${selectedMachine.id}`]?.contextKey === machinesKey
              }
              onChange={(event) => handleMachineStatusChange(event.target.value)}
              autoComplete="off"
            >
              {machineStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="section-card" aria-labelledby="sensor-admin-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Sensor configuration</p>
            <h2 id="sensor-admin-title">Five inductive proximity sensors</h2>
          </div>
          <div className="live-refresh">
            <span className="section-chip">
              <Cpu size={16} aria-hidden="true" />
              {hasCurrentSensors ? sensors.length : 0} shown
            </span>
            <button
              className="btn btn-success table-action-button sensors-refresh-button"
              type="button"
              aria-label="Refresh sensors"
              disabled={sensorsState === 'loading'}
              onClick={() => setSensorsRefresh((current) => current + 1)}
            >
              <RotateCw className={sensorsState === 'loading' ? 'spin-icon' : ''} size={16} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>

        {recoveryOverrideSensor ? (
          <form className="sensor-recovery-override" aria-labelledby="sensor-recovery-override-title" onSubmit={submitRecoveryOverride}>
            <div>
              <p className="section-eyebrow">Manual recovery override</p>
              <h3 id="sensor-recovery-override-title">
                Confirm {recoveryOverrideSensor.sensorCode} recovery
              </h3>
              <p>
                This records a production override, closes open downtime, recalculates the machine, and marks the alert recovered. It does not create or replace a physical sensor event.
              </p>
            </div>
            <label className="filter-field" htmlFor="sensor-recovery-override-reason">
              <span>Override reason</span>
              <textarea
                id="sensor-recovery-override-reason"
                value={recoveryOverrideReason}
                maxLength={500}
                required
                autoFocus
                onChange={(event) => setRecoveryOverrideReason(event.target.value)}
              />
            </label>
            <div className="table-actions">
              <button className="btn btn-success" type="submit" disabled={!recoveryOverrideReason.trim()}>
                Confirm recovery
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setRecoveryOverrideSensor(null)
                  setRecoveryOverrideReason('')
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {sensorsState === 'loading' && hasCurrentSensors ? (
          <div className="notice dashboard-alert" role="status" aria-live="polite">Refreshing sensors...</div>
        ) : null}

        {sensorsState === 'stale' && hasCurrentSensors ? (
          <div className="notice notice-error dashboard-alert" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              Sensor data is stale. Showing the last successful result from{' '}
              <time dateTime={sensorsLastUpdated?.toISOString()}>
                {sensorsLastUpdated ? formatSuccessfulUpdate(sensorsLastUpdated) : 'an earlier update'}
              </time>
              . {sensorsError}
            </span>
            <button className="btn btn-secondary table-action-button" type="button" onClick={() => setSensorsRefresh((current) => current + 1)}>
              Retry sensors
            </button>
          </div>
        ) : null}

        {sensorsDisplayState === 'error' ? (
          <div className="section-placeholder" aria-labelledby="sensors-error-title">
            <div className="section-copy">
              <p className="section-eyebrow">Sensors unavailable</p>
              <h3 id="sensors-error-title">Unable to load machine sensors</h3>
              <p role="alert">{sensorsError}</p>
              <button className="btn btn-secondary" type="button" onClick={() => setSensorsRefresh((current) => current + 1)}>
                Retry sensors
              </button>
            </div>
          </div>
        ) : sensorsDisplayState === 'loading' && !hasCurrentSensors ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading machine sensors...</span>
            <div className="skeleton skeleton-panel" aria-hidden="true" />
          </div>
        ) : hasCurrentSensors && sensors.length === 0 ? (
          <p className="table-muted">No sensors are connected to this machine.</p>
        ) : hasCurrentSensors ? (
          <div className="admin-sensor-grid">
            {sensors.map((sensor) => (
              <article key={sensor.id} className={`machine-card admin-sensor-card ${getSensorStatusClass(sensor.status)}`}>
                <div className="machine-card-header">
                  <div>
                    <p className="machine-id">{sensor.sensorCode}</p>
                    <h3>{getSensorLabel(sensor.sensorCode, sensor.label)}</h3>
                  </div>
                  <span className={`status-badge ${getSensorStatusClass(sensor.status)}`}>{sensor.status}</span>
                </div>

                <dl className="machine-meta live-sensor-meta">
                  <div>
                    <dt>Device ID</dt>
                    <dd>{sensor.esp32DeviceId}</dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd>{getSensorPurpose(sensor.sensorCode, sensor.purpose)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatShortDateTime(sensor.updatedAt)}</dd>
                  </div>
                </dl>

                <label className="filter-field" htmlFor={`sensor-status-${sensor.id}`}>
                  <span>Sensor status</span>
                  <select
                    id={`sensor-status-${sensor.id}`}
                    name={`sensorStatus-${sensor.sensorCode}`}
                    value={sensor.status}
                    disabled={
                      sensorsState !== 'success'
                      || pendingOperations[`sensor-${sensor.id}`]?.contextKey === sensorsKey
                    }
                    onChange={(event) => {
                      const nextStatus = event.target.value
                      if (nextStatus === 'Active' && sensor.status !== 'Active') {
                        setRecoveryOverrideSensor(sensor)
                        setRecoveryOverrideReason('')
                        setNotice(null)
                        return
                      }
                      void handleSensorStatusChange(sensor, nextStatus)
                    }}
                    autoComplete="off"
                  >
                    {sensorStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                {sensor.status === 'Active' && selectedMachine.status === 'Downtime' ? (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => {
                      setRecoveryOverrideSensor(sensor)
                      setRecoveryOverrideReason('')
                      setNotice(null)
                    }}
                  >
                    Reconcile recovery
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
