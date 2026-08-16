import { describe, expect, it } from 'vitest'
import { buildAnalyticsSnapshot } from './analyticsService.js'
import {
  buildAnalyticsTrend,
  formatCompactDuration,
  getAnalyticsKpis,
  getAnalyticsTrendSummary,
  getDowntimeCauseBreakdown,
  getProcessSensorBreakdown,
  getTrendEvaluation,
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

  it('groups downtime by supported cause and process records by neutral sensor code', () => {
    const snapshot = buildAnalyticsSnapshot()

    expect(getDowntimeCauseBreakdown(snapshot)).toEqual([
      expect.objectContaining({ cause: 'Corrective Maintenance', eventCount: 1, durationMinutes: 43 }),
      expect.objectContaining({ cause: 'Manual Cutting', eventCount: 1, durationMinutes: 31 }),
      expect.objectContaining({ cause: 'Weld Wire Refill', eventCount: 1, durationMinutes: 26 }),
      expect.objectContaining({ cause: 'Coil Joint', eventCount: 1, durationMinutes: 18 }),
      expect.objectContaining({ cause: 'Flux Refill', eventCount: 1, durationMinutes: 12 }),
    ])
    expect(getProcessSensorBreakdown(snapshot)).toEqual([
      { sensorCode: 'S-01', eventCount: 1 },
      { sensorCode: 'S-02', eventCount: 1 },
      { sensorCode: 'S-03', eventCount: 1 },
      { sensorCode: 'S-04', eventCount: 1 },
      { sensorCode: 'S-05', eventCount: 1 },
    ])
  })

  it('formats compact duration for donut chart centers without exceeding inner radius', () => {
    expect(formatCompactDuration(0)).toBe('0m')
    expect(formatCompactDuration(43)).toBe('43m')
    expect(formatCompactDuration(60)).toBe('1h')
    expect(formatCompactDuration(130)).toBe('2h 10m')
  })

  it('evaluates trend directions and assigns red for downtime increases and green for production increases', () => {
    const increasingDowntimeTrend = {
      metric: { id: 'downtime' },
      points: [{ value: 10 }, { value: 30 }, { value: 50 }],
    }
    const decreasingDowntimeTrend = {
      metric: { id: 'downtime' },
      points: [{ value: 50 }, { value: 30 }, { value: 10 }],
    }
    const increasingProductionTrend = {
      metric: { id: 'production' },
      points: [{ value: 100 }, { value: 120 }, { value: 150 }],
    }
    const decreasingProductionTrend = {
      metric: { id: 'production' },
      points: [{ value: 150 }, { value: 120 }, { value: 100 }],
    }

    const downtimeInc = getTrendEvaluation(increasingDowntimeTrend)
    expect(downtimeInc.direction).toBe('up')
    expect(downtimeInc.strokeColor).toBe('var(--chart-danger)')
    expect(downtimeInc.sentiment).toBe('negative')

    const downtimeDec = getTrendEvaluation(decreasingDowntimeTrend)
    expect(downtimeDec.direction).toBe('down')
    expect(downtimeDec.strokeColor).toBe('var(--chart-target)')
    expect(downtimeDec.sentiment).toBe('positive')

    const prodInc = getTrendEvaluation(increasingProductionTrend)
    expect(prodInc.direction).toBe('up')
    expect(prodInc.strokeColor).toBe('var(--chart-target)')
    expect(prodInc.sentiment).toBe('positive')

    const prodDec = getTrendEvaluation(decreasingProductionTrend)
    expect(prodDec.direction).toBe('down')
    expect(prodDec.strokeColor).toBe('var(--chart-danger)')
    expect(prodDec.sentiment).toBe('negative')

    // Monthly or Custom range with leading and trailing zero buckets
    const monthDowntimeTrend = {
      metric: { id: 'downtime' },
      points: [
        { value: 0 }, { value: 0 }, { value: 0 },
        { value: 43 }, { value: 35 }, { value: 24 }, { value: 16 }, { value: 12 },
        { value: 0 }, { value: 0 }, { value: 0 },
      ],
    }
    const monthDowntimeEval = getTrendEvaluation(monthDowntimeTrend)
    expect(monthDowntimeEval.direction).toBe('down')
    expect(monthDowntimeEval.strokeColor).toBe('var(--chart-target)')
    expect(monthDowntimeEval.sentiment).toBe('positive')

    // Empty date range with all zeroes
    const emptyTrend = {
      metric: { id: 'downtime' },
      points: [{ value: 0 }, { value: 0 }, { value: 0 }],
    }
    const emptyEval = getTrendEvaluation(emptyTrend)
    expect(emptyEval.direction).toBe('flat')
    expect(emptyEval.strokeColor).toBe('var(--chart-current)')
    expect(emptyEval.sentiment).toBe('neutral')
  })
})
