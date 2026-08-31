import { describe, expect, it } from 'vitest'
import { analyticsTestFixture } from './analyticsTestFixtures.js'
import {
  buildAnalyticsTrend,
  formatAnalyticsTrendValue,
  formatCompactDuration,
  getAnalyticsKpis,
  getAnalyticsTrendSummary,
  getDowntimeCauseBreakdown,
  getDowntimeSensorBreakdown,
  getProcessSensorBreakdown,
  getTrendEvaluation,
  getVisibleAnalyticsTrendPoints,
} from './analyticsPresentation.js'

describe('Analytics presentation helpers', () => {
  it('formats backend-provided summaries without recomputing operational metrics', () => {
    expect(getAnalyticsKpis(analyticsTestFixture)).toEqual([
      expect.objectContaining({ id: 'downtime', value: '130 min', helper: '5 recorded events' }),
      expect.objectContaining({ id: 'availability', value: '91%' }),
      expect.objectContaining({ id: 'production', value: '595 pcs' }),
      expect.objectContaining({ id: 'process-events', value: '5' }),
      expect.objectContaining({
        id: 'estimated-loss',
        value: '6.5 pcs',
        helper: 'Configured fallback: 0.05 pcs/min',
      }),
    ])
    expect(formatAnalyticsTrendValue(91, { unit: 'percent' })).toBe('91%')
  })

  it('distinguishes unobserved null values from measured zeroes', () => {
    const snapshot = {
      ...analyticsTestFixture,
      selected: {
        ...analyticsTestFixture.selected,
        summary: {
          ...analyticsTestFixture.selected.summary,
          downtimeMinutes: 0,
          downtimeEventCount: null,
          availabilityPercent: null,
          outputPieces: 0,
        },
      },
    }

    const kpis = getAnalyticsKpis(snapshot)
    expect(kpis.find((item) => item.id === 'downtime')?.value).toBe('0 min')
    expect(kpis.find((item) => item.id === 'downtime')?.helper).toBe('Event count not observed')
    expect(kpis.find((item) => item.id === 'availability')?.value).toBe('—')
    expect(kpis.find((item) => item.id === 'production')?.value).toBe('0 pcs')
  })

  it('uses server-generated selected and comparison trends in the same unit-safe series', () => {
    const downtime = buildAnalyticsTrend(analyticsTestFixture, 'downtime')
    const availability = buildAnalyticsTrend(analyticsTestFixture, 'availability')

    expect(downtime.metric.unit).toBe('minutes')
    expect(downtime.points).toHaveLength(7)
    expect(downtime.points[0]).toMatchObject({ value: 43, comparisonValue: 20 })
    expect(downtime.points.at(-1)).toMatchObject({ value: null })
    expect(availability.points.at(-1)).toMatchObject({ value: null })
    expect(downtime.bucket).toBe('daily')
  })

  it('preserves unmatched monthly comparison segments under the explicit ordinal contract', () => {
    const snapshot = {
      ...analyticsTestFixture,
      trendAlignment: { mode: 'ordinal-calendar-segments', selectedBucketCount: 1, comparisonBucketCount: 2 },
      selected: { ...analyticsTestFixture.selected, trends: analyticsTestFixture.selected.trends.slice(0, 1) },
      comparison: { ...analyticsTestFixture.comparison, trends: analyticsTestFixture.comparison.trends.slice(0, 2) },
    }

    const trend = buildAnalyticsTrend(snapshot, 'production')
    expect(trend.points).toHaveLength(2)
    expect(trend.points[1]).toMatchObject({
      label: 'Prior 2', selectedLabel: 'No selected segment', hasSelectedSegment: false, comparisonValue: 110,
    })
    expect(getVisibleAnalyticsTrendPoints(trend.points)).toHaveLength(2)
    expect(trend.isCalendarSegmentComparison).toBe(true)
    expect(getAnalyticsTrendSummary(trend)).toBe('595 pcs across 1 observed bucket.')
  })

  it('provides a visible summary from the selected server summary', () => {
    const trend = buildAnalyticsTrend(analyticsTestFixture, 'process-events')
    expect(getAnalyticsTrendSummary(trend)).toBe('5 events across 6 observed buckets.')
    expect(getVisibleAnalyticsTrendPoints(trend.points)).toHaveLength(6)
  })

  it('separates passed null buckets from future buckets', () => {
    const trend = buildAnalyticsTrend({
      ...analyticsTestFixture,
      selected: {
        ...analyticsTestFixture.selected,
        trends: analyticsTestFixture.selected.trends.map((point, index) => (
          index === 4 ? { ...point, metrics: { ...point.metrics, processEventCount: null } } : point
        )),
      },
    }, 'process-events')

    expect(getAnalyticsTrendSummary(trend)).toBe('5 events across 5 observed buckets; 1 bucket is unobserved.')
  })

  it('returns the server-provided downtime cause and sensor aggregations unchanged', () => {
    expect(getDowntimeCauseBreakdown(analyticsTestFixture)).toEqual(analyticsTestFixture.selected.downtimeCauses)
    expect(getDowntimeSensorBreakdown(analyticsTestFixture)).toEqual(analyticsTestFixture.selected.downtimeSensors)
    expect(getProcessSensorBreakdown(analyticsTestFixture)).toEqual(analyticsTestFixture.selected.processSensors)
  })

  it('formats compact duration for donut chart centers', () => {
    expect(formatCompactDuration(0)).toBe('0m')
    expect(formatCompactDuration(43)).toBe('43m')
    expect(formatCompactDuration(60)).toBe('1h')
    expect(formatCompactDuration(130)).toBe('2h 10m')
  })

  it('evaluates only observed trend points', () => {
    const result = getTrendEvaluation({
      metric: { id: 'production' },
      points: [{ value: 100 }, { value: 120 }, { value: null }],
    })

    expect(result.direction).toBe('up')
    expect(result.strokeColor).toBe('var(--chart-target)')
  })

  it('reports conventional first-to-last change without regression percentages below minus 100 percent', () => {
    const result = getTrendEvaluation({
      metric: { id: 'production' },
      points: [{ value: 100 }, { value: 0 }, { value: 0 }],
    })

    expect(result.deltaPercent).toBe(-100)
    expect(result.label).toBe('Trending down (-100.0%)')
  })

  it('labels a fully unobserved trend without implying a steady measurement', () => {
    const result = getTrendEvaluation({
      metric: { id: 'production' },
      points: [{ value: null }, { value: null }],
    })

    expect(result.label).toBe('Not observed')
  })
})
