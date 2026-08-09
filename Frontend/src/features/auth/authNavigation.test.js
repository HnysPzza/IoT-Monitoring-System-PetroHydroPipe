import { describe, expect, it } from 'vitest'
import { getSafeDashboardPath } from './authNavigation.js'

describe('getSafeDashboardPath', () => {
  it('preserves dashboard paths with query and hash', () => {
    expect(getSafeDashboardPath('/dashboard/reports?type=weekly#rows')).toBe('/dashboard/reports?type=weekly#rows')
  })

  it.each([
    'https://example.com/dashboard',
    '//example.com/dashboard',
    '/login',
    '/dashboard-impersonation',
    null,
  ])('falls back for unsafe or non-dashboard destinations: %s', (candidate) => {
    expect(getSafeDashboardPath(candidate)).toBe('/dashboard')
  })
})
