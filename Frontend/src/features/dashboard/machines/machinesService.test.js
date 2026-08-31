import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../../../shared/services/apiClient.js'
import { updateSensorStatus } from './machinesService.js'

vi.mock('../../../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))

describe('machinesService', () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it('sends the required reason with a manual recovery override', async () => {
    apiRequest.mockResolvedValue({ sensor: { status: 'Active' } })

    await updateSensorStatus('token', 'sensor-1', 'Active', 'Maintenance verified recovery')

    expect(apiRequest).toHaveBeenCalledWith('/api/machines/sensors/sensor-1/status', {
      token: 'token',
      method: 'PATCH',
      body: { status: 'Active', overrideReason: 'Maintenance verified recovery' },
    })
  })
})
