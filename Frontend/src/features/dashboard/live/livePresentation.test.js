import { describe, expect, it } from 'vitest'
import { presentLiveSensor } from './livePresentation.js'

function sensor(overrides = {}) {
  return {
    sensorCode: 'S-01',
    status: 'Idle',
    monitoring: {
      stateFresh: true,
      connectivityState: 'online',
      detectionState: 'healthy',
    },
    ...overrides,
  }
}

describe('live sensor presentation', () => {
  it('maps grace, observe downtime, recovery, and offline connectivity separately', () => {
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'grace' } }), 'observe')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Idle — grace period' })
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: true, connectivityState: 'offline', detectionState: 'downtime' } }), 'observe')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Idle — threshold observed', connectivityLabel: 'Offline' })
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'recovering' } }), 'enforce')).toMatchObject({ displayStatus: 'Downtime', stateLabel: 'Downtime — recovery confirmation' })
  })

  it('gives confirmed operational downtime precedence and never assigns absence state to S-05', () => {
    expect(presentLiveSensor(sensor({ status: 'Downtime' }), 'observe').stateLabel).toBe('Confirmed operational downtime')
    expect(presentLiveSensor(sensor({ sensorCode: 'S-05', monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'downtime' } }), 'enforce')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Production output sensing' })
  })

  it('labels disabled and stale monitoring without inventing downtime', () => {
    expect(presentLiveSensor(sensor(), 'disabled')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring disabled' })
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: false, connectivityState: null, detectionState: null } }), 'observe')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring data unavailable' })
  })
})
