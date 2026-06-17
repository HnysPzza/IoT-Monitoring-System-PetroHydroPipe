import { MemoryRouter } from 'react-router-dom'
import { render } from '@testing-library/react'
import { AuthContext } from '../features/auth/authSession.jsx'

export function renderWithAuth(ui, { authValue = {}, route = '/' } = {}) {
  const defaultAuthValue = {
    token: 'test-token',
    user: {
      id: 'user-1',
      name: 'admin',
      username: 'admin',
      role: 'Admin',
    },
    isAuthenticated: true,
    login: async () => ({ token: 'test-token', user: { role: 'Admin' } }),
    logout: () => {},
  }

  return render(
    <AuthContext.Provider value={{ ...defaultAuthValue, ...authValue }}>
      <MemoryRouter initialEntries={[route]}>
        {ui}
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}
