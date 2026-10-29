import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { USER_ROLE_STORAGE_KEY } from '../../features/auth/authNavigation.js'
import { renderWithAuth } from '../../test/renderWithAuth.jsx'
import NotFoundPage from './NotFoundPage.jsx'

describe('NotFoundPage', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders the 404 page concept, logo header, sparks, and role-aware dashboard link', () => {
    window.localStorage.setItem(USER_ROLE_STORAGE_KEY, 'Admin')

    const { container } = renderWithAuth(<NotFoundPage />, {
      authValue: { isAuthenticated: false, user: null },
      route: '/missing-route',
    })

    expect(screen.getByAltText('PetroHydroPipe logo')).toBeInTheDocument()
    expect(screen.getByText('PETROHYDROPIPE')).toBeInTheDocument()
    expect(screen.queryByText(/error page/i)).not.toBeInTheDocument()
    expect(screen.getByText('PAGE NOT FOUND')).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /this page isn’t here/i })).toBeInTheDocument()
    expect(
      screen.getByText(/the page may have been moved, renamed, or the link is wrong\./i),
    ).toBeInTheDocument()

    const dashboardLink = screen.getByRole('link', { name: /back to dashboard/i })
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument()
    expect(container.querySelectorAll('.error-spark').length).toBeGreaterThan(0)
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
  })

  it('calls window.history.back() when browser history has a previous entry', async () => {
    const user = userEvent.setup()
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)

    renderWithAuth(<NotFoundPage />, { route: '/unknown' })

    await user.click(screen.getByRole('button', { name: /go back/i }))
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to navigating to /dashboard when there is no browser history or external referrer', async () => {
    const user = userEvent.setup()
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2)
    vi.spyOn(window.history, 'state', 'get').mockReturnValue(null)
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://evil.example.com/phish')

    renderWithAuth(<NotFoundPage />, { route: '/unknown' })

    await user.click(screen.getByRole('button', { name: /go back/i }))
    expect(backSpy).not.toHaveBeenCalled()
  })
})
