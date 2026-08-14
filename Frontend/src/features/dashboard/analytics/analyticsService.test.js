import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAnalyticsSnapshot,
  createAnalyticsFixtureService,
  getAnalyticsSnapshot,
  resolveAnalyticsRange,
} from './analyticsService.js'

describe('Analytics local fixture service', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses a deterministic Monday-start week and automatic daily buckets', () => {
    expect(resolveAnalyticsRange()).toEqual({
      period: 'this-week',
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      daysInclusive: 7,
      bucket: 'daily',
    })
  })

  it('uses the approved automatic bucket boundaries for custom ranges', () => {
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-08-12', endDate: '2026-08-13' }).bucket).toBe('four-hour')
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-08-01', endDate: '2026-08-14' }).bucket).toBe('daily')
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-06-01', endDate: '2026-08-31' }).bucket).toBe('weekly')
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-01-01', endDate: '2026-04-04' }).bucket).toBe('monthly')
  })

  it('rejects an inverted custom range instead of silently producing misleading data', () => {
    expect(() => resolveAnalyticsRange({
      period: 'custom',
      startDate: '2026-08-14',
      endDate: '2026-08-10',
    })).toThrow('The end date must be on or after the start date.')
  })

  it('filters the local fixture by the inclusive selected range without mutating it', () => {
    const snapshot = buildAnalyticsSnapshot({
      period: 'custom',
      startDate: '2026-08-13',
      endDate: '2026-08-14',
    })

    expect(snapshot.machine).toEqual({ code: 'M-01', name: 'Spiral Mill 01' })
    expect(snapshot.downtimeEvents.map((event) => event.id)).toEqual(['demo-downtime-004', 'demo-downtime-005'])
    expect(snapshot.processEvents).toHaveLength(2)
    expect(snapshot.productionRecords.map((record) => record.date)).toEqual(['2026-08-13', '2026-08-14'])
  })

  it('does not use fetch to load a fixture snapshot', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(getAnalyticsSnapshot()).resolves.toMatchObject({ source: 'local-fixture' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exposes an injectable failure seam for deterministic error-state tests', async () => {
    const service = createAnalyticsFixtureService({ failure: new Error('Fixture unavailable') })

    await expect(service.getSnapshot()).rejects.toThrow('Fixture unavailable')
  })
})
