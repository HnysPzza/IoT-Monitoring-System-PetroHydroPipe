import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithAuth } from '../test/renderWithAuth.jsx'
import { ProtectedRoute } from './App.jsx'

function LoginDestination() {
  const location = useLocation()
  return <span>{JSON.stringify(location.state)}</span>
}

describe('ProtectedRoute', () => {
  it('preserves the current safe dashboard pathname, query, and hash', async () => {
    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginDestination />} />
        <Route
          path="/dashboard/reports"
          element={(
            <ProtectedRoute>
              <span>Protected content</span>
            </ProtectedRoute>
          )}
        />
      </Routes>,
      {
        authValue: { isAuthenticated: false, sessionExpired: true, token: null, user: null },
        route: '/dashboard/reports?type=weekly#rows',
      },
    )

    expect(await screen.findByText('{"from":"/dashboard/reports?type=weekly#rows","sessionExpired":true}')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })
})
