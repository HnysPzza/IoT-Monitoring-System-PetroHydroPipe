import { MemoryRouter } from 'react-router'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '../features/auth/authSession.jsx'
import { ThemeContext } from '../shared/context/ThemeContext.jsx'

export function renderWithAuth(ui, { authValue = {}, themeValue = { theme: 'light', setTheme: () => {} }, route = '/' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
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
    <QueryClientProvider client={queryClient}>
    <AuthContext.Provider value={{ ...defaultAuthValue, ...authValue }}>
      <ThemeContext.Provider value={themeValue}>
        <MemoryRouter initialEntries={[route]}>
          {ui}
        </MemoryRouter>
      </ThemeContext.Provider>
    </AuthContext.Provider>
    </QueryClientProvider>,
  )
}
