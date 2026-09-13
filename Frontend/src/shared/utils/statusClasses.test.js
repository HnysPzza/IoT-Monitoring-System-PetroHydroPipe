import { describe, expect, it } from 'vitest'
import { getLiveStatusClass, getSensorStatusClass } from './statusClasses.js'

describe('getLiveStatusClass', () => {
  it('renders a fault with the fault status style', () => {
    expect(getLiveStatusClass('Fault')).toBe('status-downtime')
  })
})

describe('getSensorStatusClass', () => {
  it('distinguishes a sensor fault from machine downtime', () => {
    expect(getSensorStatusClass('Fault')).toBe('status-fault')
    expect(getSensorStatusClass('Downtime')).toBe('status-downtime')
  })
})
