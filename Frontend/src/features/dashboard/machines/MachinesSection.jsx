import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Cpu, Factory, MapPin, RadioTower, RotateCw } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel, getSensorPurpose } from '../../../shared/constants/sensorIdentity.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getMachineStatusClass, getSensorStatusClass } from '../../../shared/utils/statusClasses.js'
import { getMachines, getMachineSensors, updateMachineStatus, updateSensorStatus } from './machinesService.js'

const machineStatuses = ['Running', 'Idle', 'Downtime']
const sensorStatuses = ['Active', 'Inactive', 'Fault']

function EmptyMachinesState() {
  return (
    <section className="section-card section-placeholder" aria-labelledby="machines-empty-title">
      <div className="section-copy">
        <p className="section-eyebrow">No records</p>
        <h1 id="machines-empty-title">No machines found</h1>
        <p>Add Spiral Mill 01 and its five sensors to manage machine setup here.</p>
      </div>
    </section>
  )
}

export default function MachinesSection() {
  const { token } = useAuth()
  const [machines, setMachines] = useState([])
  const [selectedMachineId, setSelectedMachineId] = useState('')
  const [sensors, setSensors] = useState([])
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingSensors, setIsLoadingSensors] = useState(false)
  const [updatingKey, setUpdatingKey] = useState('')

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.id === selectedMachineId) || machines[0],
    [machines, selectedMachineId],
  )

  async function loadMachines() {
    setIsLoading(true)
    setNotice(null)

    try {
      const payload = await getMachines(token)
      const nextMachines = payload.machines || []
      setMachines(nextMachines)
      setSelectedMachineId((current) => current || nextMachines[0]?.id || '')
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to load machines.' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadMachines()
  }, [token])

  useEffect(() => {
    let isMounted = true

    async function loadSensors() {
      if (!selectedMachine?.id) {
        setSensors([])
        return
      }

      setIsLoadingSensors(true)

      try {
        const payload = await getMachineSensors(token, selectedMachine.id)

        if (isMounted) {
          setSensors(payload.sensors || [])
        }
      } catch (error) {
        if (isMounted) {
          setNotice({ type: 'error', message: error.message || 'Unable to load machine sensors.' })
        }
      } finally {
        if (isMounted) {
          setIsLoadingSensors(false)
        }
      }
    }

    loadSensors()

    return () => {
      isMounted = false
    }
  }, [selectedMachine?.id, token])

  async function handleMachineStatusChange(status) {
    if (!selectedMachine) return

    setUpdatingKey(`machine-${selectedMachine.id}`)
    setNotice(null)

    try {
      const payload = await updateMachineStatus(token, selectedMachine.id, status)
      setMachines((current) => current.map((machine) => (machine.id === payload.machine.id ? payload.machine : machine)))
      setNotice({ type: 'success', message: `${payload.machine.name} is now ${payload.machine.status}.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to update machine status.' })
    } finally {
      setUpdatingKey('')
    }
  }

  async function handleSensorStatusChange(sensor, status) {
    setUpdatingKey(`sensor-${sensor.id}`)
    setNotice(null)

    try {
      const payload = await updateSensorStatus(token, sensor.id, status)
      setSensors((current) => current.map((item) => (item.id === payload.sensor.id ? payload.sensor : item)))
      setNotice({ type: 'success', message: `${getSensorLabel(payload.sensor.sensorCode, payload.sensor.label)} is now ${payload.sensor.status}.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to update sensor status.' })
    } finally {
      setUpdatingKey('')
    }
  }

  if (isLoading) {
    return (
      <div className="machines-layout">
        <section className="section-card">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-panel" />
        </section>
      </div>
    )
  }

  if (!machines.length) {
    return <EmptyMachinesState />
  }

  return (
    <div className="machines-layout">
      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      ) : null}

      <section className="section-card machine-admin-hero" aria-labelledby="machine-admin-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Machine registry</p>
            <h2 id="machine-admin-title">{selectedMachine.name}</h2>
          </div>
          <button className="btn btn-secondary table-action-button" type="button" onClick={loadMachines}>
            <RotateCw size={16} aria-hidden="true" />
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
            <span>ESP32 Sensors</span>
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
              disabled={updatingKey === `machine-${selectedMachine.id}`}
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
            <p className="section-eyebrow">ESP32 configuration</p>
            <h2 id="sensor-admin-title">Connected sensors</h2>
          </div>
          <span className="section-chip">
            <Cpu size={16} aria-hidden="true" />
            {sensors.length} shown
          </span>
        </div>

        {isLoadingSensors ? (
          <div className="skeleton skeleton-panel" />
        ) : sensors.length === 0 ? (
          <p className="table-muted">No sensors are connected to this machine.</p>
        ) : (
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
                    <dt>ESP32 ID</dt>
                    <dd>{sensor.esp32DeviceId}</dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd>{sensor.purpose || getSensorPurpose(sensor.sensorCode)}</dd>
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
                    disabled={updatingKey === `sensor-${sensor.id}`}
                    onChange={(event) => handleSensorStatusChange(sensor, event.target.value)}
                    autoComplete="off"
                  >
                    {sensorStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
