import { describe, expect, it } from 'vitest'
import { getReadableDetails, getReadableSource } from '../features/dashboard/audit/auditFormatters.js'
import { getAlertDestination, getAlertKind } from '../shared/utils/alertPresentation.js'
import scenarios from '../../../Backend/tests/fixtures/sensor-consumer-scenarios.json'

describe('sensor audit and alert ownership', () => {
  it('explains timed downtime and recovery under S-03 instead of generic system actions', () => {
    const created = { action: 'WATCHDOG_DOWNTIME_CREATED', entityType: 'downtime', metadata: { sensorCode: 'S-02', ownerSensorCode: 'S-03' } }
    expect(getReadableDetails(created)).toMatch(/S-03.*downtime/i)
    expect(getReadableSource(created)).toBe('Sensors')
    expect(getReadableDetails({ ...created, action: 'WATCHDOG_DOWNTIME_RESOLVED' })).toMatch(/S-03.*recovered/i)
  })

  it('describes a lost connection independently of machine downtime', () => {
    const log = { action: 'CONNECTIVITY_ALERT_CREATED', entityType: 'sensor_connectivity', metadata: { sensorCode: 'S-01' } }
    expect(getReadableDetails(log)).toMatch(/S-01.*offline/i)
    expect(getReadableDetails({ ...log, action: 'CONNECTIVITY_ALERT_RESOLVED' })).toMatch(/S-01.*reconnected/i)
  })

  for (const scenario of scenarios) {
    it(`${scenario.name}: process warnings and S-03 downtime have distinct destinations`, () => {
      for (const sensorCode of scenario.faultCodes.filter((code) => code !== 'S-03')) {
        const alert = { sensorCode, metadata: { processFault: true } }
        expect(getAlertKind(alert).label).toBe('Sensor fault')
        expect(getAlertDestination(alert).to).toBe('/dashboard/live')
      }
      if (scenario.downtime) {
        const alert = { sensorCode: 'S-03', metadata: { downtimeId: 'interval-1' } }
        expect(getAlertKind(alert).label).toBe('Downtime')
        expect(getAlertDestination(alert).to).toBe('/dashboard/downtime')
      }
    })
  }
})
