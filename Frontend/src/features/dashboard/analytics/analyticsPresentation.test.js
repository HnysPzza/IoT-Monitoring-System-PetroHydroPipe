import { describe, expect, it } from 'vitest'
import { buildAnalyticsSnapshot } from './analyticsService.js'
import {
  buildAnalyticsTrend,
  getAnalyticsKpis,
  getAnalyticsTrendSummary,
} from './analyticsPresentation.js'

describe('Analytics presentation helpers', () => {
  it('derives KPI values from local records without a target output metric', () => {
    const snapshot = buildAnalyticsSnapshot()
    const kpis = getAnalyticsKpis(snapshot)

    expect(kpis).toEqual([
      expect.objectContaining({ id: 'downtime', value: '130 min' }),
      expect.objectContaining({ id: 'availability', value: '98.7%' }),
      expect.objectContaining({ id: 'production', value: '595 pcs' }),
      expect.objectContaining({ id: 'process-events', value: '5' }),
    ])
    expect(kpis.some((kpi) => /target/i.test(kpi.label))).toBe(false)
  })

  it('preserves a real zero-percent availability instead of replacing it with 100 percent', () => {
    const kpis = getAnalyticsKpis({
      range: { daysInclusive: 1 },
      downtimeEvents: [{ durationMinutes: 1440 }],
      productionRecords: [],
      processEvents: [],
    })

    expect(kpis.find((kpi) => kpi.id === 'availability')?.value).toBe('0.0%')
  })

  it('keeps each trend metric in its own unit-safe series', () => {
    const snapshot = buildAnalyticsSnapshot()
    const downtime = buildAnalyticsTrend(snapshot, 'downtime')
    const production = buildAnalyticsTrend(snapshot, 'production')
    const availability = buildAnalyticsTrend(snapshot, 'availability')

    expect(downtime.metric.unit).toBe('minutes')
    expect(downtime.points).toHaveLength(7)
    expect(downtime.points.reduce((total, point) => total + point.value, 0)).toBe(130)
    expect(production.metric.unit).toBe('pieces')
    expect(production.points.reduce((total, point) => total + point.value, 0)).toBe(595)
    expect(availability.metric.unit).toBe('percent')
    expect(availability.points.every((point) => point.value >= 0 && point.value <= 100)).toBe(true)
  })

  it('uses four-hour buckets for ranges of two days or less', () => {
    const snapshot = buildAnalyticsSnapshot({
      period: 'custom',
      startDate: '2026-08-10',
      endDate: '2026-08-11',
    })
    const trend = buildAnalyticsTrend(snapshot, 'downtime')

    expect(snapshot.range.bucket).toBe('four-hour')
    expect(trend.points).toHaveLength(12)
    expect(trend.points.find((point) => point.label === 'Aug 10 08:00')?.value).toBe(43)
  })

  it('keeps date-only production records in daily buckets instead of inventing midnight output', () => {
    const snapshot = buildAnalyticsSnapshot({
      period: 'custom',
      startDate: '2026-08-10',
      endDate: '2026-08-11',
    })
    const trend = buildAnalyticsTrend(snapshot, 'production')

    expect(snapshot.range.bucket).toBe('four-hour')
    expect(trend.bucket).toBe('daily')
    expect(trend.usesDailyProductionFallback).toBe(true)
    expect(trend.points).toEqual([
      expect.objectContaining({ label: 'Aug 10', value: 118 }),
      expect.objectContaining({ label: 'Aug 11', value: 122 }),
    ])
  })

  it('provides a visible text summary that matches the selected metric', () => {
    const trend = buildAnalyticsTrend(buildAnalyticsSnapshot(), 'process-events')

    expect(getAnalyticsTrendSummary(trend)).toBe('5 events across 7 buckets.')
  })
})
