import { apiRequest } from '../../../shared/services/apiClient.js'
import { presentLiveSensors } from './livePresentation.js'

export async function getLiveFeed(token) {
  const payload = await apiRequest('/api/iot/live', { token })
  return {
    ...payload,
    sensors: presentLiveSensors(payload.sensors || [], payload.monitoring?.mode).map((sensor) => ({
      ...sensor,
      operationalStatus: sensor.status,
      status: sensor.displayStatus,
    })),
  }
}
