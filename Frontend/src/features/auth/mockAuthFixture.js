// Development fixture only. Real login uses /api/auth/login when VITE_USE_MOCK_LOGIN is false.
const MOCK_PASSWORD = 'password123'

// Role accounts used only when mock login is explicitly enabled in the frontend env.
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

export async function mockLogin({ username, password }) {
  // Keeps mock username matching the backend's lowercase lookup behavior.
  const normalizedUsername = username.trim().toLowerCase()
  const mockUser = MOCK_USERS[normalizedUsername]

  if (mockUser && password === MOCK_PASSWORD) {
    return mockUser
  }

  return null
}
