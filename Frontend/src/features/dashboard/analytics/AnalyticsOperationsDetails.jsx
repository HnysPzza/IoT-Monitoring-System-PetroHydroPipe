import { useEffect, useMemo, useState } from 'react'
import { Activity, Clock3, Filter } from 'lucide-react'
import {
  formatAnalyticsDateTime,
  getDowntimeCauseBreakdown,
  getProcessSensorBreakdown,
} from './analyticsPresentation.js'

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`
}

function getNewestFirst(rows, key) {
  return [...rows].sort((left, right) => String(right[key]).localeCompare(String(left[key])))
}

export default function AnalyticsOperationsDetails({ snapshot }) {
  const [selectedCause, setSelectedCause] = useState('all')
  const [selectedSensor, setSelectedSensor] = useState('all')
  const causes = useMemo(() => getDowntimeCauseBreakdown(snapshot), [snapshot])
  const sensors = useMemo(() => getProcessSensorBreakdown(snapshot), [snapshot])

  useEffect(() => {
    setSelectedCause('all')
    setSelectedSensor('all')
  }, [snapshot])

  const totalDowntimeMinutes = causes.reduce((total, cause) => total + cause.durationMinutes, 0)
  const downtimeRows = getNewestFirst(
    selectedCause === 'all'
      ? snapshot.downtimeEvents
      : snapshot.downtimeEvents.filter((event) => event.cause === selectedCause),
    'startedAt',
  )
  const processRows = getNewestFirst(
    selectedSensor === 'all'
      ? snapshot.processEvents
      : snapshot.processEvents.filter((event) => event.sensorCode === selectedSensor),
    'occurredAt',
  )

  return (
    <div className="analytics-operations-layout">
      <section className="section-card analytics-detail-card" aria-labelledby="analytics-downtime-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Maintenance and downtime</p>
            <h2 id="analytics-downtime-title">Cause contribution</h2>
          </div>
          <span className="section-chip">
            <Clock3 size={16} aria-hidden="true" />
            {formatDuration(totalDowntimeMinutes)} recorded
          </span>
        </div>

        <p className="analytics-detail-intro">
          Select a cause to filter the event record below. These are the currently supported local cause labels only.
        </p>

        <div className="analytics-breakdown-list" role="group" aria-label="Filter downtime records by cause">
          <button
            className={`analytics-breakdown-button ${selectedCause === 'all' ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={selectedCause === 'all'}
            onClick={() => setSelectedCause('all')}
          >
            <span>All causes</span>
            <strong>{formatDuration(totalDowntimeMinutes)}</strong>
          </button>
          {causes.map((cause) => {
            const percentage = totalDowntimeMinutes
              ? Math.round((cause.durationMinutes / totalDowntimeMinutes) * 100)
              : 0

            return (
              <button
                key={cause.cause}
                className={`analytics-breakdown-button ${selectedCause === cause.cause ? 'is-selected' : ''}`}
                type="button"
                aria-pressed={selectedCause === cause.cause}
                onClick={() => setSelectedCause(cause.cause)}
              >
                <span className="analytics-breakdown-copy">
                  <span>{cause.cause}</span>
                  <small>{cause.eventCount} event{cause.eventCount === 1 ? '' : 's'} - {percentage}% of recorded downtime</small>
                </span>
                <strong>{formatDuration(cause.durationMinutes)}</strong>
              </button>
            )
          })}
        </div>

        <div className="analytics-table-heading">
          <div>
            <p className="section-eyebrow">Event record</p>
            <h3>Downtime events</h3>
          </div>
          <span>{downtimeRows.length} shown</span>
        </div>
        <div className="account-table-wrap">
          <table className="account-table analytics-event-table" aria-label="Downtime event records">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Cause</th>
                <th scope="col">Sensor</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {downtimeRows.length === 0 ? (
                <tr>
                  <td colSpan="4">No local downtime events match this cause.</td>
                </tr>
              ) : downtimeRows.map((event) => (
                <tr key={event.id}>
                  <td data-label="Started">{formatAnalyticsDateTime(event.startedAt, snapshot.timeZone)}</td>
                  <td data-label="Cause">{event.cause}</td>
                  <td data-label="Sensor">{event.sensorCode}</td>
                  <td data-label="Duration">{formatDuration(event.durationMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-card analytics-detail-card" aria-labelledby="analytics-process-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Process</p>
            <h2 id="analytics-process-title">Events by sensor code</h2>
          </div>
          <span className="section-chip">
            <Activity size={16} aria-hidden="true" />
            {snapshot.processEvents.length} recorded
          </span>
        </div>

        <p className="analytics-detail-intro">
          Sensor labels stay neutral until the final sensor-reading semantics are confirmed.
        </p>

        <div className="analytics-sensor-filter" role="group" aria-label="Filter process events by sensor code">
          <button
            className={`analytics-sensor-filter-button ${selectedSensor === 'all' ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={selectedSensor === 'all'}
            onClick={() => setSelectedSensor('all')}
          >
            <Filter size={15} aria-hidden="true" />
            All sensors
          </button>
          {sensors.map((sensor) => (
            <button
              key={sensor.sensorCode}
              className={`analytics-sensor-filter-button ${selectedSensor === sensor.sensorCode ? 'is-selected' : ''}`}
              type="button"
              aria-label={`${sensor.sensorCode}, ${sensor.eventCount} process event${sensor.eventCount === 1 ? '' : 's'}`}
              aria-pressed={selectedSensor === sensor.sensorCode}
              onClick={() => setSelectedSensor(sensor.sensorCode)}
            >
              {sensor.sensorCode}
              <span>{sensor.eventCount}</span>
            </button>
          ))}
        </div>

        <div className="analytics-table-heading">
          <div>
            <p className="section-eyebrow">Event record</p>
            <h3>Process events</h3>
          </div>
          <span>{processRows.length} shown</span>
        </div>
        <div className="account-table-wrap">
          <table className="account-table analytics-event-table" aria-label="Process event records">
            <thead>
              <tr>
                <th scope="col">Recorded</th>
                <th scope="col">Sensor</th>
                <th scope="col">Event</th>
              </tr>
            </thead>
            <tbody>
              {processRows.length === 0 ? (
                <tr>
                  <td colSpan="3">No local process events match this sensor.</td>
                </tr>
              ) : processRows.map((event) => (
                <tr key={event.id}>
                  <td data-label="Recorded">{formatAnalyticsDateTime(event.occurredAt, snapshot.timeZone)}</td>
                  <td data-label="Sensor">{event.sensorCode}</td>
                  <td data-label="Event">{event.eventType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
