import { apiRequest } from '../../shared/services/apiClient.js'

const USE_MOCK_LOGIN = import.meta.env.VITE_USE_MOCK_LOGIN === 'true'

// Small delay keeps mock mode close to a real backend request habang development pa.
function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function makeAuthError(message) {
  const error = new Error(message)
  error.status = 401
  return error
}

export async function login({ username, password }) {
  // Mock mode is a dev fallback only; real mode calls the Express auth endpoint.
  if (USE_MOCK_LOGIN) {
    await delay(700)

    const { mockLogin } = await import('./mockAuthFixture.js')
    const mockUser = await mockLogin({ username, password })

    if (mockUser) {
      return mockUser
    }

    throw makeAuthError('Invalid username or password.')
  }

  try {
    // Backend returns the same { token, user } shape used by AuthContext.
    return await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      fallbackError: 'Unable to sign in. Please try again.',
    })
  } catch (error) {
    if (error.status === 401) {
      throw makeAuthError('Invalid username or password.')
    }

    throw error
  }
}
