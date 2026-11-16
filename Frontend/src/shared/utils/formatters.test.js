import { describe, expect, it } from 'vitest'
import { cleanCode } from './formatters.js'

describe('cleanCode', () => {
  it('preserves numeric zero instead of falling back', () => {
    expect(cleanCode(0, 'No signal yet')).toBe('0')
  })

  it('uses the fallback for null, undefined, and empty strings', () => {
    expect(cleanCode(null, 'No signal yet')).toBe('No signal yet')
    expect(cleanCode(undefined, 'No signal yet')).toBe('No signal yet')
    expect(cleanCode('', 'No signal yet')).toBe('No signal yet')
  })
})
