import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../../../shared/services/apiClient.js'
import { getMachines } from './machinesService.js'

vi.mock('../../../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))

describe('machinesService', () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it('reads machines through the backend API', async () => {
    apiRequest.mockResolvedValue({ machines: [] })

    await getMachines('test-token')

    expect(apiRequest).toHaveBeenCalledWith('/api/machines', { token: 'test-token' })
  })
})
