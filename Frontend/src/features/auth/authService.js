const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
const USE_MOCK_LOGIN = import.meta.env.VITE_USE_MOCK_LOGIN === 'true'
const MOCK_PASSWORD = 'password123'

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

const MOCK_USERS = {
  admin: {
    token: 'mock-admin-token',
    user: {
      name: 'admin',
      role: 'Admin',
    },
  },
  opmanager: {
    token: 'mock-operations-manager-token',
    user: {
      name: 'Amiel Reyes',
      role: 'Operation Manager',
    },
  },
  asstmanager: {
    token: 'mock-assistant-operations-manager-token',
    user: {
      name: 'Leah Dizon',
      role: 'Asst. Operation Manager',
    },
  },
  engsupervisor: {
    token: 'mock-engineering-supervisor-token',
    user: {
      name: 'Nico Peralta',
      role: 'Engineering Supervisor',
    },
  },
  prodsupervisor: {
    token: 'mock-production-supervisor-token',
    user: {
      name: 'Mara Santos',
      role: 'Production Supervisor',
    },
  },
}

export async function login({ username, password }) {
  if (USE_MOCK_LOGIN) {
    await delay(700)

    const normalizedUsername = username.trim().toLowerCase()
    const mockUser = MOCK_USERS[normalizedUsername]

    if (mockUser && password === MOCK_PASSWORD) {
      return mockUser
    }

    throw makeAuthError('Invalid username or password.')
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw makeAuthError('Invalid username or password.')
    }

    throw new Error('Unable to sign in. Please try again.')
  }

  return response.json()
}
