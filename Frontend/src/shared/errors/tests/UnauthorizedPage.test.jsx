import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import UnauthorizedPage from '../UnauthorizedPage.jsx'

describe('UnauthorizedPage', () => {
  it('renders the 401 sign-in required error screen with compact brand header and illustration', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/reports?type=weekly#rows']}>
        <UnauthorizedPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('SIGN-IN REQUIRED')).toBeInTheDocument()
    expect(screen.getByText('401')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /please sign in again/i })).toBeInTheDocument()
    expect(
      screen.getByText(/your session has expired or you’re not signed in\. sign in to pick up where you left off\./i),
    ).toBeInTheDocument()
    expect(screen.getByAltText('PetroHydroPipe logo')).toBeInTheDocument()
    expect(screen.getByText('PETROHYDROPIPE')).toBeInTheDocument()
    expect(document.querySelector('.error-state-illustration')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/login?next=%2Fdashboard%2Freports%3Ftype%3Dweekly%23rows',
    )
  })

  it('links Sign In to /login without a next query when already at /dashboard or a non-dashboard route', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <UnauthorizedPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
  })
})
