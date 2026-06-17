import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithAuth } from '../../test/renderWithAuth.jsx'
import RequireRole from './RequireRole.jsx'

describe('RequireRole', () => {
  it('renders children for allowed roles', () => {
    renderWithAuth(
      <RequireRole roles={['Admin']}>
        <p>Allowed section</p>
      </RequireRole>,
    )

    expect(screen.getByText('Allowed section')).toBeInTheDocument()
  })

  it('renders permission message for blocked roles', () => {
    renderWithAuth(
      <RequireRole roles={['Admin']}>
        <p>Allowed section</p>
      </RequireRole>,
      { authValue: { user: { id: 'user-2', role: 'Production Supervisor' } } },
    )

    expect(screen.getByText(/you do not have permission/i)).toBeInTheDocument()
  })
})
