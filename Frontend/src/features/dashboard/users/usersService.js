const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

async function readJson(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  return JSON.parse(text)
}

function getErrorMessage(payload, fallback) {
  if (payload?.error?.message) {
    return payload.error.message
  }

  return fallback
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await readJson(response)

  if (!response.ok) {
    const error = new Error(getErrorMessage(payload, 'Unable to complete request.'))
    error.status = response.status
    error.payload = payload
    throw error
  }

  return payload
}

export function getUsers(token) {
  return request('/api/users', { token })
}

export function getRoles(token) {
  return request('/api/users/roles', { token })
}

export function createUser(token, values) {
  return request('/api/users', {
    token,
    method: 'POST',
    body: values,
  })
}

export function updateUserStatus(token, userId, status) {
  return request(`/api/users/${userId}/status`, {
    token,
    method: 'PATCH',
    body: { status },
  })
}
