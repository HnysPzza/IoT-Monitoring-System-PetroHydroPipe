import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../../../shared/services/apiClient.js'
import { getAnalyticsSnapshot, resolveAnalyticsRange } from './analyticsService.js'
import { analyticsTestResponse } from './analyticsTestFixtures.js'

vi.mock('../../../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))

describe('Analytics API service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses a deterministic Monday-start week and automatic daily buckets', () => {
    expect(resolveAnalyticsRange({ referenceDate: '2026-08-14' })).toEqual({
      period: 'this-week', startDate: '2026-08-10', endDate: '2026-08-16', daysInclusive: 7, bucket: 'daily',
    })
  })

  it('uses the approved automatic bucket boundaries for custom ranges', () => {
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-08-12', endDate: '2026-08-13' }).bucket).toBe('four-hour')
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-08-01', endDate: '2026-08-14' }).bucket).toBe('daily')
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-06-01', endDate: '2026-08-31' }).bucket).toBe('weekly')
    expect(resolveAnalyticsRange({ period: 'custom', startDate: '2026-01-01', endDate: '2026-04-04' }).bucket).toBe('monthly')
  })

  it('resolves all recorded history as a backend-owned monthly range', () => {
    expect(resolveAnalyticsRange({ period: 'all' })).toEqual({
      period: 'all', range: 'all', bucket: 'monthly',
    })
  })

  it('rejects invalid or inverted custom ranges before making a request', () => {
    expect(() => resolveAnalyticsRange({ period: 'custom', startDate: '2026-08-14', endDate: '2026-08-10' }))
      .toThrow('The end date must be on or after the start date.')
    expect(() => resolveAnalyticsRange({ period: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }))
      .toThrow('A valid start date is required.')
    expect(() => resolveAnalyticsRange({ period: 'custom', startDate: '2025-01-01', endDate: '2026-01-02' }))
      .toThrow('Analytics date range must be 1 to 366 days.')
  })

  it('loads recorded Analytics through the shared authenticated API client', async () => {
    apiRequest.mockResolvedValue(analyticsTestResponse)

    await expect(getAnalyticsSnapshot('auth-token', {
      period: 'custom', startDate: '2026-08-10', endDate: '2026-08-16',
    })).resolves.toEqual(analyticsTestResponse.analytics)

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/analytics?startDate=2026-08-10&endDate=2026-08-16',
      { token: 'auth-token', fallbackError: 'Unable to load Analytics.' },
    )
  })

  it('requests the backend-owned first-record range for all-time Analytics', async () => {
    apiRequest.mockResolvedValue(analyticsTestResponse)

    await getAnalyticsSnapshot('auth-token', { period: 'all' })

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/analytics?range=all',
      { token: 'auth-token', fallbackError: 'Unable to load Analytics.' },
    )
  })

  it('rejects a successful response that omits the Analytics contract', async () => {
    apiRequest.mockResolvedValue({ analytics: null })

    await expect(getAnalyticsSnapshot('auth-token', { referenceDate: '2026-08-14' }))
      .rejects.toThrow('The server returned an invalid Analytics response.')
  })

  it('rejects malformed nested comparison, metric, distribution, and alignment contracts', async () => {
    const malformedResponses = [
      { ...analyticsTestResponse.analytics, comparison: { ...analyticsTestResponse.analytics.comparison, range: null } },
      {
        ...analyticsTestResponse.analytics,
        selected: {
          ...analyticsTestResponse.analytics.selected,
          summary: { ...analyticsTestResponse.analytics.selected.summary, outputPieces: '595' },
        },
      },
      {
        ...analyticsTestResponse.analytics,
        selected: { ...analyticsTestResponse.analytics.selected, processSensors: [{ sensorCode: 'S-01' }] },
      },
      {
        ...analyticsTestResponse.analytics,
        selected: { ...analyticsTestResponse.analytics.selected, downtimeCauses: [{ cause: 'Maintenance' }] },
      },
      {
        ...analyticsTestResponse.analytics,
        selected: { ...analyticsTestResponse.analytics.selected, downtimeSensors: [{ sensorCode: 'S-01' }] },
      },
      {
        ...analyticsTestResponse.analytics,
        trendAlignment: { ...analyticsTestResponse.analytics.trendAlignment, comparisonBucketCount: 99 },
      },
    ]

    for (const analytics of malformedResponses) {
      apiRequest.mockResolvedValueOnce({ analytics })
      await expect(getAnalyticsSnapshot('auth-token', { referenceDate: '2026-08-14' }))
        .rejects.toThrow('The server returned an invalid Analytics response.')
    }
  })
})
