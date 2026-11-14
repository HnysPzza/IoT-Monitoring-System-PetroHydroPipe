import { describe, expect, it } from 'vitest'
import { getLiveStatusClass, getSensorStatusClass } from './statusClasses.js'

describe('getLiveStatusClass', () => {
  it('renders a fault with the fault status style and offline snapshots cleanly', () => {
    expect(getLiveStatusClass('Fault')).toBe('status-fault')
    expect(getLiveStatusClass('Offline')).toBe('status-offline')
    expect(getLiveStatusClass('Last: Run')).toBe('status-offline')
    expect(getLiveStatusClass('Unavailable')).toBe('status-unavailable')
  })
})

describe('getSensorStatusClass', () => {
  it('distinguishes fault, downtime, offline, and unavailable states', () => {
    expect(getSensorStatusClass('Fault')).toBe('status-fault')
    expect(getSensorStatusClass('Downtime')).toBe('status-downtime')
    expect(getSensorStatusClass('Offline')).toBe('status-offline')
    expect(getSensorStatusClass('Last: Fault')).toBe('status-offline')
    expect(getSensorStatusClass('Unavailable')).toBe('status-unavailable')
  })
})
