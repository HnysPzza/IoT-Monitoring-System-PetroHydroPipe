import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../../../shared/services/apiClient.js'
import { getDashboardOverview } from './dashboardService.js'

vi.mock('../../../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))

function overviewPayload() {
  return {
    alerts: [],
    summary: [{ id: 'pipes', label: 'Production Output', value: '1 pcs', helper: 'Today' }],
    productionAnalytics: {
      day: {
        label: 'Today so far vs Yesterday at same time',
        currentLabel: 'Today so far',
        previousLabel: 'Yesterday at same time',
        currentTotal: 1,
        previousTotal: 0,
        difference: 1,
        differencePercent: null,
        unit: 'pcs',
        points: [
          { label: '6AM', current: 1, previous: 0, periodState: 'current' },
          { label: '9AM', current: null, previous: null, periodState: 'future' },
        ],
      },
    },
  }
}

describe('dashboard overview service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts the production overview contract', async () => {
    apiRequest.mockResolvedValue(overviewPayload())

    await expect(getDashboardOverview('auth-token')).resolves.toEqual(overviewPayload())
  })

  it('rejects successful malformed production overview responses', async () => {
    const malformedPayloads = [
      { ...overviewPayload(), productionAnalytics: null },
      { ...overviewPayload(), productionAnalytics: { day: { ...overviewPayload().productionAnalytics.day, points: null } } },
      { ...overviewPayload(), summary: [{ id: 'pipes', label: null, value: '1 pcs', helper: 'Today' }] },
    ]

    for (const payload of malformedPayloads) {
      apiRequest.mockResolvedValueOnce(payload)
      await expect(getDashboardOverview('auth-token'))
        .rejects.toThrow('The server returned an invalid dashboard overview response.')
    }
  })
})
