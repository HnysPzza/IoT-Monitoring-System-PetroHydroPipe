import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, PackageMinus, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getDowntimeStatusClass } from '../../../shared/utils/statusClasses.js'
import { getDowntimeRecords, updateDowntimeRecord } from './downtimeService.js'

const statusFilters = ['All', 'Open', 'Resolved']
const downtimeCauses = [
  'Corrective Maintenance',
  'Manual Cutting',
  'Coil Joint',
  'Weld Wire Refill',
  'Flux Refill',
  'Pending Cause Review',
]

function getRecordLabel(record) {
  const sensorName = record.sensor ? formatSensorName(record.sensor) : 'selected sensor'
  return `${record.machine || 'Machine'} / ${sensorName}`
}

export default function DowntimeSection() {
  const { token } = useAuth()
  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState({ open: 0, resolved: 0, minutes: 0, loss: 0 })
  const [statusFilter, setStatusFilter] = useState('All')
  const [causeFilter, setCauseFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10))
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [updatingRecordId, setUpdatingRecordId] = useState('')

  async function loadDowntimeRecords() {
    setIsLoading(true)
    setNotice(null)

    try {
      const payload = await getDowntimeRecords(token, {
        status: statusFilter,
        cause: causeFilter,
        date: dateFilter,
      })
      setRecords(payload.records || [])
      setSummary(payload.summary || { open: 0, resolved: 0, minutes: 0, loss: 0 })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to load downtime records.' })
      setRecords([])
      setSummary({ open: 0, resolved: 0, minutes: 0, loss: 0 })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDowntimeRecords()
  }, [causeFilter, dateFilter, statusFilter, token])

  async function updateCause(recordId, cause) {
    setUpdatingRecordId(recordId)
    setNotice(null)

    try {
      const payload = await updateDowntimeRecord(token, recordId, { cause })
      setRecords((current) => current.map((record) => (record.id === payload.record.id ? payload.record : record)))
      setNotice({ type: 'success', message: `${getRecordLabel(payload.record)} cause updated to ${payload.record.cause}.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to update downtime cause.' })
    } finally {
      setUpdatingRecordId('')
    }
  }

  async function resolveRecord(recordId) {
    setUpdatingRecordId(recordId)
    setNotice(null)

    try {
      const payload = await updateDowntimeRecord(token, recordId, { status: 'Resolved' })
      setRecords((current) => current.map((record) => (record.id === payload.record.id ? payload.record : record)))
      setNotice({ type: 'success', message: `${getRecordLabel(payload.record)} downtime resolved.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to resolve downtime record.' })
    } finally {
      setUpdatingRecordId('')
    }
  }

  return (
    <div className="downtime-layout">
      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      ) : null}

      <div className="kpi-grid">
        <article className="section-card stat-card">
          <p className="stat-label">Open Downtime</p>
          <p className="stat-value">{summary.open}</p>
          <p className="stat-helper">Requires review</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">Resolved Today</p>
          <p className="stat-value">{summary.resolved}</p>
          <p className="stat-helper">Today only</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">Total Downtime</p>
          <p className="stat-value">{summary.minutes} min</p>
          <p className="stat-helper">Today only</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">Estimated Loss</p>
          <p className="stat-value">{summary.loss} pcs</p>
          <p className="stat-helper">Based on downtime duration</p>
        </article>
      </div>

      <section className="section-card downtime-controls-card" aria-label="Downtime filters">
        <div className="trend-mode-toggle" role="group" aria-label="Filter downtime by status">
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
        <label className="filter-field" htmlFor="downtime-cause-filter">
          <span>Cause</span>
          <select
            id="downtime-cause-filter"
            name="downtimeCause"
            value={causeFilter}
            onChange={(event) => setCauseFilter(event.target.value)}
            autoComplete="off"
          >
            <option value="All">All causes</option>
            {downtimeCauses.map((cause) => (
              <option key={cause} value={cause}>{cause}</option>
            ))}
          </select>
        </label>
        <label className="filter-field" htmlFor="downtime-date-filter">
          <span>Date</span>
          <input
            id="downtime-date-filter"
            name="downtimeDate"
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            autoComplete="off"
          />
        </label>
      </section>

      <section className="section-card downtime-table-card" aria-labelledby="downtime-records-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Event records</p>
            <h2 id="downtime-records-title">Downtime records</h2>
          </div>
          <span className="section-chip">
            <TriangleAlert size={16} aria-hidden="true" />
            {records.length} shown
          </span>
        </div>

        {isLoading ? (
          <div className="skeleton skeleton-panel" />
        ) : (
          <div className="account-table-wrap">
          <table className="account-table downtime-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Machine/Sensor</th>
                <th scope="col">Cause</th>
                <th scope="col">Started</th>
                <th scope="col">Ended</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">Notes</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan="9">No downtime records match the selected filters.</td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.id}</td>
                    <td>{record.machine}<br /><span className="table-muted">{formatSensorName(record.sensor)}</span></td>
                    <td>
                      <label className="sr-only" htmlFor={`downtime-cause-${record.id}`}>Cause for {record.id}</label>
                      <select
                        id={`downtime-cause-${record.id}`}
                        name={`downtimeCause-${record.id}`}
                        className="inline-select"
                        value={record.cause}
                        disabled={updatingRecordId === record.id}
                        onChange={(event) => updateCause(record.id, event.target.value)}
                        autoComplete="off"
                      >
                        {downtimeCauses.map((cause) => (
                          <option key={cause} value={cause}>{cause}</option>
                        ))}
                      </select>
                    </td>
                    <td>{formatShortDateTime(record.startedAt)}</td>
                    <td>{formatShortDateTime(record.endedAt, 'Still open')}</td>
                    <td>{record.durationMinutes} min</td>
                    <td><span className={`status-badge ${getDowntimeStatusClass(record.status)}`}>{record.status}</span></td>
                    <td>{record.notes}</td>
                    <td>
                      <button
                        className="btn btn-secondary table-action-button table-action-activate"
                        type="button"
                        disabled={record.status === 'Resolved' || updatingRecordId === record.id}
                        onClick={() => resolveRecord(record.id)}
                      >
                        <CheckCircle2 size={16} aria-hidden="true" />
                        {updatingRecordId === record.id ? 'Saving' : 'Resolve'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section className="section-card live-network-card">
        <Clock size={18} aria-hidden="true" />
        <span>Downtime records, cause assignment, and resolve actions are stored through the backend API.</span>
        <PackageMinus size={18} aria-hidden="true" />
      </section>
    </div>
  )
}
