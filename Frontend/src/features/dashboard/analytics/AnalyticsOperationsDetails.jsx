import { useEffect, useMemo, useState } from 'react'
import { Activity, Clock3 } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
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

export default function AnalyticsOperationsDetails({ snapshot }) {
  const [activeSensorIndex, setActiveSensorIndex] = useState(null)
  const downtimeCauses = useMemo(() => getDowntimeCauseBreakdown(snapshot), [snapshot])
  const sensors = useMemo(() => getProcessSensorBreakdown(snapshot), [snapshot])

  useEffect(() => {
    setActiveSensorIndex(null)
  }, [snapshot])

  const totalDowntimeMinutes = snapshot.selected.summary.downtimeMinutes
  const totalDowntimeEvents = snapshot.selected.summary.downtimeEventCount
  const causeCoverage = snapshot.selected.causeCoverage
  const hasObservedDowntime = totalDowntimeMinutes !== null && totalDowntimeMinutes !== undefined
  const hasSubMinuteDowntimeEvents = hasObservedDowntime
    && totalDowntimeMinutes === 0
    && totalDowntimeEvents > 0
  const reviewedDurationMinutes = causeCoverage?.reviewedDurationMinutes ?? 0
  // Keep this summary to four rows so it remains compact beside Process events.
  const causeChartRows = useMemo(() => {
    const sortedCauses = [...downtimeCauses].sort((left, right) => (
      right.durationMinutes - left.durationMinutes || left.cause.localeCompare(right.cause)
    ))
    const visibleCauses = sortedCauses.slice(0, 3)
    const remainingCauses = sortedCauses.slice(3)

    if (remainingCauses.length === 0) return visibleCauses

    const remaining = remainingCauses.reduce((totals, cause) => ({
      eventCount: totals.eventCount + cause.eventCount,
      durationMinutes: totals.durationMinutes + cause.durationMinutes,
      estimatedLossPieces: totals.estimatedLossPieces + cause.estimatedLossPieces,
    }), { eventCount: 0, durationMinutes: 0, estimatedLossPieces: 0 })

    return [
      ...visibleCauses,
      {
        cause: 'Remaining causes',
        ...remaining,
        estimatedLossPieces: Number(remaining.estimatedLossPieces.toFixed(2)),
        remainingCauseCount: remainingCauses.length,
      },
    ]
  }, [downtimeCauses])
  const causeDistribution = causeChartRows.map((cause, index) => {
    const percentage = reviewedDurationMinutes > 0
      ? Math.round((cause.durationMinutes / reviewedDurationMinutes) * 100)
      : 0

    return {
      ...cause,
      color: CAUSE_COLORS[index % CAUSE_COLORS.length],
      percentage,
      percentageLabel: formatDowntimePercentage(percentage, cause.durationMinutes),
    }
  })
  const maxCauseDurationMinutes = Math.max(...causeDistribution.map((cause) => cause.durationMinutes), 1)
  const hasRenderableCauseData = hasObservedDowntime && causeDistribution.length > 0 && reviewedDurationMinutes > 0

  const totalProcessEvents = snapshot.selected.summary.processEventCount
  const hasObservedProcessEvents = totalProcessEvents !== null && totalProcessEvents !== undefined
  const sensorDistribution = sensors.map((sensor, index) => ({
    ...sensor,
    color: SENSOR_COLORS[index % SENSOR_COLORS.length],
    percentage: hasObservedProcessEvents && totalProcessEvents > 0
      ? Math.round((sensor.eventCount / totalProcessEvents) * 100)
      : 0,
  }))

  return (
    <div className="analytics-operations-layout">
      <section className="section-card analytics-detail-card" aria-labelledby="analytics-downtime-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Maintenance and downtime</p>
            <h2 id="analytics-downtime-title">Downtime by cause</h2>
          </div>
          <span className="section-chip">
            <Clock3 size={16} aria-hidden="true" />
            {hasObservedDowntime ? `${formatDuration(totalDowntimeMinutes)} downtime` : 'Not observed'}
          </span>
        </div>

        {hasRenderableCauseData ? (
          <div className="analytics-downtime-cause-plot">
            <div className="analytics-downtime-cause-plot-heading" aria-hidden="true">
              <span>Cause</span>
              <span>Duration</span>
              <span>Share</span>
            </div>

            <div className="analytics-downtime-cause-chart" role="img" aria-label="Downtime by cause chart">
              <ResponsiveContainer width="100%" height={220} minWidth={0}>
                <BarChart
                  layout="vertical"
                  data={causeDistribution}
                  margin={{ top: 26, right: 48, left: 8, bottom: 8 }}
                  barCategoryGap="24%"
                  accessibilityLayer={false}
                >
                  <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="3 7" horizontal={false} />
                  <XAxis
                    type="number"
                    dataKey="durationMinutes"
                    domain={[0, maxCauseDurationMinutes]}
                    allowDecimals={false}
                    orientation="top"
                    tickLine={false}
                    axisLine={{ stroke: 'var(--subtle-border)' }}
                    tick={{ fill: 'var(--c-text-3)', fontSize: 10, fontFamily: "'Inter', sans-serif" }}
                    tickFormatter={(minutes) => minutes >= 60 ? `${Math.round(minutes / 60)} hr` : `${minutes} min`}
                  />
                  <YAxis
                    type="category"
                    dataKey="cause"
                    width={124}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--c-text)', fontSize: 11, fontWeight: 600, fontFamily: "'Inter', sans-serif" }}
                  />
                  <Bar
                    dataKey="durationMinutes"
                    barSize={8}
                    radius={0}
                    isAnimationActive={false}
                    rootTabIndex={-1}
                  >
                    {causeDistribution.map((cause) => (
                      <Cell key={cause.cause} fill={cause.color} />
                    ))}
                    <LabelList
                      dataKey="percentageLabel"
                      position="right"
                      offset={8}
                      fill="var(--c-text-2)"
                      fontSize={11}
                      fontFamily="'Inter', sans-serif"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <ul className="analytics-downtime-cause-accessible-list sr-only" aria-label="Downtime cause distribution">
              {causeDistribution.map((cause) => {
                const details = cause.cause === 'Remaining causes'
                  ? `${cause.remainingCauseCount} causes, ${cause.eventCount} downtime events, ${formatDuration(cause.durationMinutes)} total, ${formatDowntimePercentage(cause.percentage, cause.durationMinutes)} of reviewed downtime`
                  : `${cause.eventCount} downtime ${cause.eventCount === 1 ? 'event' : 'events'}, ${formatDuration(cause.durationMinutes)} total, ${formatDowntimePercentage(cause.percentage, cause.durationMinutes)} of reviewed downtime`

                return (
                  <li
                    key={cause.cause}
                    aria-label={`${cause.cause}: ${details}`}
                  >
                    {cause.cause}: {formatDuration(cause.durationMinutes)} · {formatDowntimePercentage(cause.percentage, cause.durationMinutes)} of reviewed downtime
                  </li>
                )
              })}
            </ul>

          </div>
        ) : (
          <div className="analytics-cause-content analytics-cause-content--empty">
            <div className="analytics-downtime-cause-empty-chart analytics-chart-empty" aria-hidden="true">
              <svg viewBox="0 0 100 60" className="analytics-empty-downtime-causes" focusable="false" preserveAspectRatio="none">
                <rect x="8" y="10" width="84" height="4" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
                <rect x="8" y="28" width="66" height="4" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
                <rect x="8" y="46" width="48" height="4" rx="2" fill="none" stroke="var(--c-text-3)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 4" />
              </svg>
            </div>
            <div
              className="analytics-cause-empty"
              {...(!hasObservedDowntime || hasSubMinuteDowntimeEvents
                ? {
                  role: 'status',
                  'aria-label': hasSubMinuteDowntimeEvents ? 'Downtime recorded under one minute' : 'Downtime not observed',
                }
                : {})}
            >
              <strong>{hasSubMinuteDowntimeEvents ? 'Downtime recorded under one minute' : !hasObservedDowntime ? 'Downtime not observed' : causeCoverage.pendingReviewEventCount > 0 ? 'No reviewed downtime causes' : 'No downtime causes recorded'}</strong>
              <span>{hasSubMinuteDowntimeEvents ? `${totalDowntimeEvents} recorded event${totalDowntimeEvents === 1 ? '' : 's'}` : !hasObservedDowntime ? 'Not observed' : '0 min recorded'}</span>
              <p>{hasSubMinuteDowntimeEvents
                ? 'Recorded downtime rounds to 0 min in this view.'
                : !hasObservedDowntime
                  ? 'This range has no observed downtime period yet.'
                  : causeCoverage.pendingReviewEventCount > 0
                    ? 'No reviewed downtime causes are available for this range.'
                    : 'No downtime causes recorded for this range.'}</p>
            </div>
          </div>
        )}

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
                    tick={{ fill: 'var(--c-text-2)', fontSize: 12, fontFamily: "'Inter', sans-serif" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--c-text-3)', fontSize: 11, fontFamily: "'Inter', sans-serif" }}
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
