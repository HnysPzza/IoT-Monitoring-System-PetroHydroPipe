import { useEffect, useMemo, useState } from 'react'
import { Activity, Clock3 } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  formatCompactDuration,
  getDowntimeCauseBreakdown,
  getDowntimeSensorBreakdown,
  getProcessSensorBreakdown,
} from './analyticsPresentation.js'

const DOWNTIME_SENSOR_COLORS = [
  'var(--chart-current)',
  'var(--chart-previous)',
  'var(--chart-target)',
  'var(--chart-warning)',
  'var(--chart-danger)',
]

const SENSOR_COLORS = [
  'var(--chart-current)',
  'var(--chart-target)',
  'var(--chart-warning)',
  'var(--chart-previous)',
  'var(--chart-danger)',
]

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`
}

function formatDowntimePercentage(percentage, durationMinutes) {
  return durationMinutes > 0 && percentage === 0 ? '<1%' : `${percentage}%`
}

export function getDonutDisplayMinutes(durationMinutes, totalMinutes) {
  return durationMinutes > 0 ? Math.max(durationMinutes, totalMinutes * 0.01) : 0
}

function DowntimeSensorTooltip({ active, payload }) {
  const sensor = payload?.[0]?.payload

  if (!active || !sensor) return null

  return (
    <div className="recharts-tooltip-card industrial-tooltip analytics-cause-tooltip" role="status">
      <strong>{sensor.sensorCode} — {sensor.sensorLabel}</strong>
      <span>{sensor.eventCount} downtime {sensor.eventCount === 1 ? 'event' : 'events'}</span>
      <span>{formatDuration(sensor.durationMinutes)}</span>
      <span>{formatDowntimePercentage(sensor.percentage, sensor.durationMinutes)} of sensor downtime</span>
    </div>
  )
}

function SensorTooltip({ active, payload }) {
  const sensor = payload?.[0]?.payload

  if (!active || !sensor) return null

  return (
    <div className="recharts-tooltip-card industrial-tooltip analytics-sensor-tooltip" role="status">
      <strong>{sensor.sensorCode} — {sensor.sensorLabel}</strong>
      <span>{sensor.eventCount} {sensor.eventCount === 1 ? 'event' : 'events'}</span>
      <span>{sensor.percentage}% of process events</span>
    </div>
  )
}

const renderActiveSector = (props) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props

  return (
    <g className="analytics-donut-active-sector">
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={Math.max(0, innerRadius - 2)}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        cornerRadius={6}
        stroke="var(--card-bg)"
        strokeWidth={3}
        strokeLinejoin="round"
        style={{
          filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.32))',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          cursor: 'pointer',
        }}
      />
    </g>
  )
}

export default function AnalyticsOperationsDetails({ snapshot }) {
  const [activeIndex, setActiveIndex] = useState(null)
  const [activeSensorIndex, setActiveSensorIndex] = useState(null)
  const downtimeCauses = useMemo(() => getDowntimeCauseBreakdown(snapshot), [snapshot])
  const downtimeSensors = useMemo(() => getDowntimeSensorBreakdown(snapshot), [snapshot])
  const sensors = useMemo(() => getProcessSensorBreakdown(snapshot), [snapshot])

  useEffect(() => {
    setActiveIndex(null)
    setActiveSensorIndex(null)
  }, [snapshot])

  const totalDowntimeMinutes = snapshot.selected.summary.downtimeMinutes
  const hasObservedDowntime = totalDowntimeMinutes !== null && totalDowntimeMinutes !== undefined
  const totalSensorDowntimeMinutes = downtimeSensors.reduce((total, sensor) => total + sensor.durationMinutes, 0)
  const downtimeDistribution = downtimeSensors.map((sensor, index) => ({
    ...sensor,
    color: DOWNTIME_SENSOR_COLORS[index % DOWNTIME_SENSOR_COLORS.length],
    chartDurationMinutes: getDonutDisplayMinutes(sensor.durationMinutes, totalSensorDowntimeMinutes),
    percentage: hasObservedDowntime && totalSensorDowntimeMinutes > 0
      ? Math.round((sensor.durationMinutes / totalSensorDowntimeMinutes) * 100)
      : 0,
  }))
  const causeDistribution = downtimeCauses.map((cause, index) => ({
    ...cause,
    color: DOWNTIME_SENSOR_COLORS[index % DOWNTIME_SENSOR_COLORS.length],
    percentage: hasObservedDowntime && totalDowntimeMinutes > 0
      ? Math.round((cause.durationMinutes / totalDowntimeMinutes) * 100)
      : 0,
  }))

  const totalProcessEvents = snapshot.selected.summary.processEventCount
  const hasObservedProcessEvents = totalProcessEvents !== null && totalProcessEvents !== undefined
  const sensorDistribution = sensors.map((sensor, index) => ({
    ...sensor,
    color: SENSOR_COLORS[index % SENSOR_COLORS.length],
    percentage: hasObservedProcessEvents && totalProcessEvents > 0
      ? Math.round((sensor.eventCount / totalProcessEvents) * 100)
      : 0,
  }))

  const activeDowntimeSensor = activeIndex !== null ? downtimeDistribution[activeIndex] : null
  const displayDuration = activeDowntimeSensor
    ? formatCompactDuration(activeDowntimeSensor.durationMinutes)
    : hasObservedDowntime ? formatCompactDuration(totalSensorDowntimeMinutes) : 'Not observed'
  const displayLabel = activeDowntimeSensor
    ? `${formatDowntimePercentage(activeDowntimeSensor.percentage, activeDowntimeSensor.durationMinutes)} DOWN`
    : 'SENSOR DOWN'

  return (
    <div className="analytics-operations-layout">
      <section className="section-card analytics-detail-card" aria-labelledby="analytics-downtime-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Maintenance and downtime</p>
            <h2 id="analytics-downtime-title">Downtime by sensor</h2>
          </div>
          <span className="section-chip">
            <Clock3 size={16} aria-hidden="true" />
            {hasObservedDowntime ? `${formatDuration(totalSensorDowntimeMinutes)} sensor downtime` : 'Not observed'}
          </span>
        </div>

        {!hasObservedDowntime || totalSensorDowntimeMinutes === 0 ? (
          <div className="analytics-cause-content analytics-cause-content--empty">
            <div className="analytics-cause-chart analytics-chart-empty" aria-hidden="true">
              <svg viewBox="0 0 100 100" className="analytics-empty-donut" focusable="false">
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  fill="none"
                  stroke="var(--c-text-3)"
                  strokeOpacity="0.55"
                  strokeWidth="2"
                  strokeDasharray="4 6"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="analytics-cause-empty" role="status" aria-label={hasObservedDowntime ? 'No sensor downtime recorded' : 'Downtime not observed'}>
              <strong>{hasObservedDowntime ? 'No sensor downtime recorded' : 'Downtime not observed'}</strong>
              <span>{hasObservedDowntime ? '0 min recorded' : 'Not observed'}</span>
              <p>{hasObservedDowntime
                ? 'No sensor downtime records fall within the selected date range yet.'
                : 'This range has no observed downtime period yet.'}</p>
            </div>
          </div>
        ) : (
          <div className="analytics-cause-content">
            <div className="analytics-cause-chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height={220} minWidth={0}>
                <PieChart accessibilityLayer={false}>
                  <Pie
                    activeIndex={activeIndex}
                    activeShape={renderActiveSector}
                    data={downtimeDistribution}
                    dataKey="chartDurationMinutes"
                    nameKey="sensorLabel"
                    cx="50%"
                    cy="50%"
                    innerRadius="52%"
                    outerRadius="82%"
                    paddingAngle={4}
                    cornerRadius={6}
                    stroke="var(--card-bg)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    isAnimationActive={true}
                    animationDuration={500}
                    animationEasing="ease-out"
                    onMouseEnter={(_, index) => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    rootTabIndex={-1}
                  >
                    {downtimeDistribution.map((sensor) => (
                      <Cell key={sensor.sensorCode} fill={sensor.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<DowntimeSensorTooltip />}
                    cursor={false}
                    position={{ y: 4 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ outline: 'none', zIndex: 10, pointerEvents: 'none' }}
                  />
                  <text
                    x="50%"
                    y="45%"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--c-text)"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '1.15rem',
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {displayDuration}
                  </text>
                  <text
                    x="50%"
                    y="59%"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={activeDowntimeSensor ? 'var(--c-accent)' : 'var(--c-text-3)'}
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {displayLabel}
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="analytics-cause-legend" aria-label="Sensor downtime distribution">
              {downtimeDistribution.map((sensor, index) => (
                <li
                  key={sensor.sensorCode}
                  className={`analytics-cause-legend-item ${activeIndex === index ? 'is-hovered' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  <span
                    className="analytics-cause-swatch"
                    style={{ backgroundColor: sensor.color }}
                    aria-hidden="true"
                  />
                  <span className="analytics-cause-copy">
                    <span className="analytics-cause-name">{sensor.sensorCode} — {sensor.sensorLabel}</span>
                    <span className="analytics-cause-meta">
                      {sensor.eventCount} downtime {sensor.eventCount === 1 ? 'event' : 'events'}
                    </span>
                    <span className="analytics-cause-meta">
                      {formatDuration(sensor.durationMinutes)} - {formatDowntimePercentage(sensor.percentage, sensor.durationMinutes)} of sensor downtime
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="analytics-cause-meta">Non-zero shares below 1% use a minimum visible slice.</p>
          </div>
        )}

        <div className="analytics-cause-breakdown">
          <h3>Downtime by cause</h3>
          {causeDistribution.length ? (
            <ul className="analytics-cause-legend" aria-label="Downtime cause distribution">
              {causeDistribution.map((cause) => (
                <li key={cause.cause} className="analytics-cause-legend-item">
                  <span className="analytics-cause-swatch" style={{ backgroundColor: cause.color }} aria-hidden="true" />
                  <span className="analytics-cause-copy">
                    <span className="analytics-cause-name">{cause.cause}</span>
                    <span className="analytics-cause-meta">
                      {cause.eventCount} downtime {cause.eventCount === 1 ? 'event' : 'events'}
                    </span>
                    <span className="analytics-cause-meta">
                      {formatDuration(cause.durationMinutes)} - {cause.percentage}% of machine downtime
                    </span>
                    <span className="analytics-cause-meta">{cause.estimatedLossPieces} pcs estimated loss</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analytics-cause-meta">No downtime causes recorded for this range.</p>
          )}
        </div>
      </section>

      <section className="section-card analytics-detail-card" aria-labelledby="analytics-process-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Process</p>
            <h2 id="analytics-process-title">Event distribution</h2>
          </div>
          <span className="section-chip">
            <Activity size={16} aria-hidden="true" />
            {hasObservedProcessEvents ? `${totalProcessEvents} recorded` : 'Not observed'}
          </span>
        </div>

        {!hasObservedProcessEvents || totalProcessEvents === 0 ? (
          <div className="analytics-cause-content analytics-cause-content--empty">
            <div className="analytics-sensor-chart analytics-chart-empty" aria-hidden="true">
              <svg viewBox="0 0 100 60" className="analytics-empty-bars" focusable="false" preserveAspectRatio="none">
                <rect x="8" y="36" width="12" height="18" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
                <rect x="26" y="24" width="12" height="30" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
                <rect x="44" y="42" width="12" height="12" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
                <rect x="62" y="30" width="12" height="24" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
                <rect x="80" y="46" width="12" height="8" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
              </svg>
            </div>
            <div className="analytics-cause-empty" role="status" aria-label={hasObservedProcessEvents ? 'No process events recorded' : 'Process events not observed'}>
              <strong>{hasObservedProcessEvents ? 'No process events recorded' : 'Process events not observed'}</strong>
              <span>{hasObservedProcessEvents ? '0 events recorded' : 'Not observed'}</span>
              <p>{hasObservedProcessEvents
                ? 'No process events fall within the selected date range yet.'
                : 'This range has no observed process-event period yet.'}</p>
            </div>
          </div>
        ) : (
          <div className="analytics-cause-content">
            <div className="analytics-sensor-chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height={220} minWidth={0}>
                <BarChart
                  data={sensorDistribution}
                  margin={{ top: 14, right: 12, left: -24, bottom: 4 }}
                  accessibilityLayer={false}
                >
                  <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="3 7" vertical={false} />
                  <XAxis
                    dataKey="sensorCode"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--c-text-2)', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--c-text-3)', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}
                  />
                  <Tooltip
                    content={<SensorTooltip />}
                    cursor={{ fill: 'color-mix(in srgb, var(--c-accent) 6%, transparent)', radius: 4 }}
                    wrapperStyle={{ outline: 'none' }}
                  />
                  <Bar
                    dataKey="eventCount"
                    radius={[6, 6, 0, 0]}
                    animationDuration={500}
                    isAnimationActive={true}
                    onMouseEnter={(_, index) => setActiveSensorIndex(index)}
                    onMouseLeave={() => setActiveSensorIndex(null)}
                    rootTabIndex={-1}
                  >
                    {sensorDistribution.map((sensor, index) => (
                      <Cell
                        key={sensor.sensorCode}
                        fill={sensor.color}
                        opacity={activeSensorIndex === null || activeSensorIndex === index ? 1 : 0.45}
                        style={{
                          transition: 'opacity 0.2s ease, filter 0.2s ease',
                          cursor: 'pointer',
                          filter: activeSensorIndex === index ? 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.25))' : 'none',
                        }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <ul className="analytics-cause-legend" aria-label="Process event distribution">
              {sensorDistribution.map((sensor, index) => (
                <li
                  key={sensor.sensorCode}
                  className={`analytics-cause-legend-item ${activeSensorIndex === index ? 'is-hovered' : ''}`}
                  onMouseEnter={() => setActiveSensorIndex(index)}
                  onMouseLeave={() => setActiveSensorIndex(null)}
                >
                  <span
                    className="analytics-cause-swatch"
                    style={{ backgroundColor: sensor.color }}
                    aria-hidden="true"
                  />
                  <span className="analytics-cause-copy">
                    <span className="analytics-cause-name">{sensor.sensorCode} — {sensor.sensorLabel}</span>
                    <span className="analytics-cause-meta">
                      {sensor.eventCount} {sensor.eventCount === 1 ? 'event' : 'events'} - {sensor.percentage}% of process events
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
