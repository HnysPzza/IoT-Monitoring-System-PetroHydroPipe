import { describe, expect, it } from 'vitest'
import { getInitials, validateAccount } from './usersUtils.js'

describe('getInitials', () => {
  it('extracts two-letter initials from full name or falls back to username', () => {
    expect(getInitials('Karl Laroa')).toBe('KL')
    expect(getInitials('Operator One Two')).toBe('OT')
    expect(getInitials('admin')).toBe('AD')
    expect(getInitials('', 'supervisor')).toBe('SU')
    expect(getInitials('', '')).toBe('U')
  })
})

describe('validateAccount', () => {
  it('returns field errors for missing or invalid account values', () => {
    const errors = validateAccount(
      {
        name: '',
        username: 'Invalid User',
        email: 'bad-email',
        role: '',
        password: 'short',
      },
      [],
    )

    expect(errors.name).toBe('Full name is required.')
    expect(errors.username).toMatch(/lowercase/)
    expect(errors.email).toBe('Enter a valid email address.')
    expect(errors.role).toBe('Select a role.')
    expect(errors.password).toBeUndefined()
  })

  it('blocks duplicate username and email before submit', () => {
    const errors = validateAccount(
      {
        name: 'Operator One',
        username: 'operator01',
        email: 'operator01@petrohydropipe.local',
        role: 'Production Supervisor',
        password: 'temporary123',
      },
      [{ username: 'operator01', email: 'operator01@petrohydropipe.local' }],
    )

    expect(errors.username).toBe('This username already exists.')
    expect(errors.email).toBe('This email already exists.')
  })
})
