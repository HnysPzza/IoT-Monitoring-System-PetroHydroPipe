import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRoleDashboardPath,
  syncRoleHint,
  USER_ROLE_STORAGE_KEY,
} from './authNavigation.js'

describe('getRoleDashboardPath', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.cookie = `${USER_ROLE_STORAGE_KEY}=; Max-Age=0; path=/`
    vi.restoreAllMocks()
  })

  it('defaults to /dashboard when no role flag or cookie exists', () => {
    expect(getRoleDashboardPath()).toBe('/dashboard')
  })

  it('resolves the dashboard path from an explicit role or stored localStorage flag', () => {
    syncRoleHint('Production Supervisor')
    expect(window.localStorage.getItem(USER_ROLE_STORAGE_KEY)).toBe('Production Supervisor')
    expect(getRoleDashboardPath()).toBe('/dashboard')
  })

  it('reads the non-sensitive cookie fallback when localStorage is empty', () => {
    document.cookie = `${USER_ROLE_STORAGE_KEY}=${encodeURIComponent('Engineering Supervisor')}; path=/`
    expect(getRoleDashboardPath()).toBe('/dashboard')
  })

  it('falls back to /dashboard if localStorage throws a security error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled')
    })

    expect(getRoleDashboardPath()).toBe('/dashboard')
  })
})
