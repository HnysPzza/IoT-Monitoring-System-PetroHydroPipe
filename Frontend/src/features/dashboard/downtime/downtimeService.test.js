import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../../../shared/services/apiClient.js'
import { getDowntimeRecords } from './downtimeService.js'

vi.mock('../../../shared/services/apiClient.js', () => ({
  apiRequest: vi.fn(),
}))

describe('downtimeService', () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it('sends pagination and filter parameters to the downtime API', async () => {
    apiRequest.mockResolvedValue({ records: [], pagination: { page: 2, totalPages: 3 } })

    await getDowntimeRecords('test-token', {
      status: 'Open',
      cause: 'Sensor Offline',
      date: '2026-07-14',
      page: 2,
      limit: 25,
    })

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/downtime?status=Open&cause=Sensor+Offline&date=2026-07-14&page=2&limit=25',
      { token: 'test-token' },
    )
  })

  it('does not send all-option filters', async () => {
    apiRequest.mockResolvedValue({ records: [], pagination: { page: 1, totalPages: 1 } })

    await getDowntimeRecords('test-token', {
      status: 'All',
      cause: 'All',
      page: 1,
      limit: 25,
    })

    expect(apiRequest).toHaveBeenCalledWith('/api/downtime?page=1&limit=25', { token: 'test-token' })
  })
})
