import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import ServerErrorPage from '../ServerErrorPage.jsx'

describe('ServerErrorPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the 500 internal server error screen, mascot illustration, and recovery actions', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    const { container } = renderWithAuth(<ServerErrorPage onRetry={onRetry} />, {
      route: '/dashboard/reports',
    })

    expect(container.querySelector('.error-page--500')).toBeInTheDocument()
    expect(screen.getByAltText('PetroHydroPipe logo')).toBeInTheDocument()
    expect(screen.getByText('PETROHYDROPIPE')).toBeInTheDocument()
    expect(screen.getByText('INTERNAL SERVER ERROR')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /something went wrong on our end\./i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/this isn’t something you did\. try reloading the page, or return to your dashboard to continue\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/if this keeps happening, contact your administrator\./i),
    ).toBeInTheDocument()

    const dashboardLink = screen.getByRole('link', { name: /back to dashboard/i })
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
  })
})
