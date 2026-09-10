import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from './renderWithAuth.jsx'
import scenarios from '../../../Backend/tests/fixtures/sensor-consumer-scenarios.json'
import { sensorIdentities } from '../shared/constants/sensorIdentity.js'
import { apiRequest } from '../shared/services/apiClient.js'
import LiveSection from '../features/dashboard/live/LiveSection.jsx'
import MachinesSection from '../features/dashboard/machines/MachinesSection.jsx'
import DashboardSection from '../features/dashboard/overview/DashboardSection.jsx'

vi.mock('../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))

afterEach(() => { cleanup(); vi.resetAllMocks() })

for (const [name, Component] of [['Live Feed', LiveSection], ['Machines', MachinesSection], ['Overview', DashboardSection]]) {
  describe(`${name} sensor contract`, () => {
    for (const scenario of scenarios) {
      it(scenario.name, async () => {
        const capturedAt = '2026-09-10T02:00:00Z'
        apiRequest.mockImplementation(async (url) => {
          if (url === '/api/iot/live') return {
            monitoring: { mode: scenario.mode, capturedAt },
            machine: { id: 'machine-1', machineCode: 'M-01', name: 'Spiral Mill 01', status: scenario.machineStatus, activeSensors: 5, lastUpdated: capturedAt },
            sensors: sensorIdentities.map((identity, index) => ({
              id: identity.code, sensorCode: identity.code, label: identity.label,
              esp32DeviceId: `esp32-${identity.code}`, status: scenario.statuses[index],
              physicalStatus: scenario.statuses[index] === 'Fault' ? 'Fault' : 'Active',
              signal: 'active', lastEventAt: capturedAt,
              monitoring: { stateFresh: true, connectivityState: scenario.offlineCode === identity.code ? 'offline' : 'online', detectionState: scenario.detection[index] },
            })),
          }
          if (url.startsWith('/api/dashboard/downtime-impact')) return { downtimeImpact: { thresholdMinutes: 30, points: [] } }
          if (url.startsWith('/api/dashboard/overview')) return {
            summary: [], alerts: [], productionAnalytics: { day: {
              label: 'Today', currentLabel: 'Today', previousLabel: 'Yesterday', unit: 'pcs',
              currentTotal: 0, previousTotal: 0, difference: 0, differencePercent: null, points: [],
            } },
          }
          throw new Error(`Unexpected API read: ${url}`)
        })
        renderWithAuth(<Component />)
        await screen.findByText('S-01')
        sensorIdentities.forEach((identity, index) => {
          const card = screen.getByText(identity.code).closest('article')
          expect(within(card).getByText(scenario.expected[index], { selector: '.status-badge' })).toBeInTheDocument()
        })
      })
    }
  })
}
