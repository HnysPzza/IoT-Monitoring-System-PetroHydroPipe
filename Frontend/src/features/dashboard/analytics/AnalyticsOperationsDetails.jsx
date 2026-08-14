import { useEffect, useMemo, useState } from 'react'
import { Activity, Clock3, Filter } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import {
  formatAnalyticsDateTime,
  getDowntimeCauseBreakdown,
  getProcessSensorBreakdown,
} from './analyticsPresentation.js'

const CAUSE_COLORS = [
  'var(--chart-current)',
  'var(--chart-previous)',
  'var(--chart-target)',
  'var(--chart-warning)',
  'var(--chart-danger)',
]

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
  const [selectedSensor, setSelectedSensor] = useState('all')
  const causes = useMemo(() => getDowntimeCauseBreakdown(snapshot), [snapshot])
  const sensors = useMemo(() => getProcessSensorBreakdown(snapshot), [snapshot])

  useEffect(() => {
    setSelectedSensor('all')
  }, [snapshot])

  const totalDowntimeMinutes = causes.reduce((total, cause) => total + cause.durationMinutes, 0)
  const causeDistribution = causes.map((cause, index) => ({
    ...cause,
    color: CAUSE_COLORS[index % CAUSE_COLORS.length],
    percentage: totalDowntimeMinutes
      ? Math.round((cause.durationMinutes / totalDowntimeMinutes) * 100)
      : 0,
  }))
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
            <h2 id="analytics-downtime-title">Cause distribution</h2>
          </div>
          <span className="section-chip">
            <Clock3 size={16} aria-hidden="true" />
            {formatDuration(totalDowntimeMinutes)} recorded
          </span>
        </div>

        <p className="analytics-detail-intro">
          Share of recorded downtime across the currently supported local cause labels.
        </p>

        {causeDistribution.length === 0 ? (
          <div className="analytics-cause-empty" role="status" aria-label="No downtime causes recorded">
            <strong>No downtime causes recorded</strong>
            <span>0 min recorded</span>
            <p>No local downtime records fall within the selected date range.</p>
          </div>
        ) : (
          <div className="analytics-cause-content">
            <div className="analytics-cause-chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height={220} minWidth={0}>
                <PieChart>
                  <Pie
                    data={causeDistribution}
                    dataKey="durationMinutes"
                    nameKey="cause"
                    cx="50%"
                    cy="50%"
                    innerRadius="56%"
                    outerRadius="78%"
                    paddingAngle={2}
                    stroke="var(--panel-bg)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {causeDistribution.map((cause) => (
                      <Cell key={cause.cause} fill={cause.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="analytics-cause-legend" aria-label="Downtime cause distribution">
              {causeDistribution.map((cause) => (
                <li key={cause.cause} className="analytics-cause-legend-item">
                  <span
                    className="analytics-cause-swatch"
                    style={{ backgroundColor: cause.color }}
                    aria-hidden="true"
                  />
                  <span className="analytics-cause-copy">
                    <span className="analytics-cause-name">{cause.cause}</span>
                    <span className="analytics-cause-meta">
                      {formatDuration(cause.durationMinutes)} - {cause.percentage}% of recorded downtime
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
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

        <div className="analytics-process-events-heading">
          <div>
            <p className="section-eyebrow">Event record</p>
            <h3>Process events</h3>
          </div>
          <span>{processRows.length} shown</span>
        </div>
        <ul className="analytics-process-event-list" aria-label="Process event records" aria-live="polite">
          {processRows.length === 0 ? (
            <li className="analytics-process-event-empty">No local process events match this sensor.</li>
          ) : processRows.map((event) => (
            <li key={event.id} className="analytics-process-event-record">
              <time className="analytics-process-event-time" dateTime={event.occurredAt}>
                {formatAnalyticsDateTime(event.occurredAt, snapshot.timeZone)}
              </time>
              <span className="analytics-process-event-sensor-code">{event.sensorCode}</span>
              <span className="analytics-process-event-type">{event.eventType}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
