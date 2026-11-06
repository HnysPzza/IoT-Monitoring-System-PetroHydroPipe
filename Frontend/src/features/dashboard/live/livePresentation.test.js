import { describe, expect, it } from 'vitest'
import { getProcessIdleBanner, getProcessSensorFaultBanner, presentLiveSensor } from './livePresentation.js'

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
  it('maps grace, observe threshold, and offline connectivity separately', () => {
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'grace' } }), 'observe')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Idle — grace period' })
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: true, connectivityState: 'offline', detectionState: 'downtime' } }), 'observe')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Idle — threshold observed', connectivityLabel: 'Offline' })
  })

  it('keeps enforced threshold and recovery as monitoring phases for every process sensor', () => {
    for (const sensorCode of ['S-01', 'S-02', 'S-04']) {
      expect(presentLiveSensor(sensor({ sensorCode, monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'downtime' } }), 'disabled')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring disabled' })
      expect(presentLiveSensor(sensor({ sensorCode, monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'downtime' } }), 'observe')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Idle — threshold observed' })
      expect(presentLiveSensor(sensor({ sensorCode, monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'downtime' } }), 'enforce')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring — threshold reached' })
      expect(presentLiveSensor(sensor({ sensorCode, monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'recovering' } }), 'enforce')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring — recovery confirmation' })
    }
  })

  it('gives confirmed operational downtime precedence and never assigns absence state to S-05', () => {
    expect(presentLiveSensor(sensor({ status: 'Downtime' }), 'observe').stateLabel).toBe('Confirmed operational downtime')
    expect(presentLiveSensor(sensor({ sensorCode: 'S-05', monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'downtime' } }), 'enforce')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Production output sensing' })
  })

  it('labels a process sensor fault without calling it downtime', () => {
    expect(presentLiveSensor(sensor({ status: 'Fault' }), 'disabled')).toMatchObject({ displayStatus: 'Fault', stateLabel: 'Process sensor fault' })
  })

  it('labels disabled and stale monitoring without inventing downtime while preserving heartbeat connectivity', () => {
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: false, connectivityState: 'online', detectionState: null } }), 'disabled')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring disabled', connectivityLabel: 'Connected' })
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: false, connectivityState: 'offline', detectionState: null } }), 'disabled')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring disabled', connectivityLabel: 'Offline' })
    expect(presentLiveSensor(sensor({ monitoring: { stateFresh: false, connectivityState: null, detectionState: null } }), 'observe')).toMatchObject({ displayStatus: 'Idle', stateLabel: 'Monitoring data unavailable', connectivityLabel: 'Unavailable' })
  })

  it('builds a material changeover banner when S-01, S-02, or S-04 is idle and no sensor is faulted', () => {
    const idleS01 = sensor({ sensorCode: 'S-01', status: 'Idle' })
    const runningS03 = sensor({ sensorCode: 'S-03', status: 'Running' })

    expect(getProcessIdleBanner([idleS01, runningS03], 'enforce')).toEqual({
      sensors: [{ sensorCode: 'S-01', label: 'Raw Material & Coil Joint' }],
      primary: { sensorCode: 'S-01', label: 'Raw Material & Coil Joint' },
      extraCount: 0,
      message: 'S-01 Raw Material & Coil Joint is idle — within trigger limit for material changeover.',
    })
  })

  it('summarizes multiple idle process sensors and keeps the idle banner separate from faults on other sensors', () => {
    const idleS01 = sensor({ sensorCode: 'S-01', status: 'Idle' })
    const graceS04 = sensor({
      sensorCode: 'S-04',
      status: 'Running',
      monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'grace' },
    })
    const banner = getProcessIdleBanner([idleS01, graceS04], 'enforce')
    expect(banner).toMatchObject({
      extraCount: 1,
      message: 'S-01 Raw Material & Coil Joint is idle — within trigger limit for material changeover.',
    })

    const faultS02 = sensor({ sensorCode: 'S-02', status: 'Fault' })
    expect(getProcessIdleBanner([idleS01, faultS02], 'enforce')).toMatchObject({
      extraCount: 0,
      message: 'S-01 Raw Material & Coil Joint is idle — within trigger limit for material changeover.',
    })
    expect(getProcessIdleBanner([faultS02], 'enforce')).toBeNull()
  })

  it('ignores S-03 and S-05 idle states for the process material changeover banner', () => {
    const idleS03 = sensor({ sensorCode: 'S-03', status: 'Idle' })
    const idleS05 = sensor({ sensorCode: 'S-05', status: 'Idle' })
    expect(getProcessIdleBanner([idleS03, idleS05], 'enforce')).toBeNull()
  })

  it('builds a fallback fault/downtime banner when a sensor is in Fault or Downtime', () => {
    const faultS01 = sensor({ sensorCode: 'S-01', status: 'Fault' })
    expect(getProcessSensorFaultBanner([faultS01], 'enforce')).toEqual({
      sensorCode: 'S-01',
      label: 'Raw Material & Coil Joint',
      extraCount: 0,
      isDowntime: false,
      message: 'S-01 Raw Material & Coil Joint process issue detected — trigger limit exceeded.',
    })

    const downtimeS03 = sensor({ sensorCode: 'S-03', status: 'Downtime' })
    expect(getProcessSensorFaultBanner([faultS01, downtimeS03], 'enforce')).toEqual({
      sensorCode: 'S-03',
      label: 'Machine Main Sensor',
      extraCount: 1,
      isDowntime: true,
      message: 'S-03 Machine Main Sensor downtime detected.',
    })
  })
})
