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

  it('renders the 403 forbidden error state with dashboard recovery link for blocked roles', () => {
    const { container } = renderWithAuth(
      <RequireRole roles={['Admin']}>
        <p>Allowed section</p>
      </RequireRole>,
      { authValue: { user: { id: 'user-2', role: 'Production Supervisor' } } },
    )

    expect(screen.queryByText('Allowed section')).not.toBeInTheDocument()
    expect(screen.getByAltText('PetroHydroPipe logo')).toBeInTheDocument()
    expect(screen.getByText('PETROHYDROPIPE')).toBeInTheDocument()
    expect(screen.queryByText(/error page/i)).not.toBeInTheDocument()
    expect(screen.getByText('403 · FORBIDDEN')).toBeInTheDocument()
    expect(screen.getByText('403')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /you don’t have access/i })).toBeInTheDocument()
    expect(
      screen.getByText(/your role can’t open this section\. return to your dashboard to continue\./i),
    ).toBeInTheDocument()

    const backLink = screen.getByRole('link', { name: /back to dashboard/i })
    expect(backLink).toHaveAttribute('href', '/dashboard')
    expect(screen.getByText('Returns to Dashboard Overview')).toBeInTheDocument()
    expect(screen.queryByText(/\/dashboard/)).not.toBeInTheDocument()
    expect(container.querySelector('.error-page')).toBeInTheDocument()
    expect(container.querySelectorAll('.error-spark').length).toBeGreaterThan(0)
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
  })
})
