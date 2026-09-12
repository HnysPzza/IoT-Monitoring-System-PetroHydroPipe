import { describe, expect, it } from 'vitest'
import { getLiveStatusClass } from './statusClasses.js'

describe('getLiveStatusClass', () => {
  it('renders a fault with the fault status style', () => {
    expect(getLiveStatusClass('Fault')).toBe('status-downtime')
  })
})
