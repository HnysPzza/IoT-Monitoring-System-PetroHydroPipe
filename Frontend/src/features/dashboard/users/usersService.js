import { apiRequest } from '../../../shared/services/apiClient.js'

// Users endpoints are protected; every request receives the JWT from AuthContext.
export function getUsers(token, query = {}, signal) {
  return apiRequest(`/api/users?${new URLSearchParams(query)}`, { token, signal })
}

export function resendSetup(token, userId) {
  return apiRequest(`/api/users/${userId}/resend-setup`, { token, method: 'POST' })
}

export function getRoles(token) {
  return apiRequest('/api/users/roles', { token })
}

export function createUser(token, values) {
  return apiRequest('/api/users', {
    token,
    method: 'POST',
    body: values,
  })
}

export function updateUserStatus(token, userId, status) {
  return apiRequest(`/api/users/${userId}/status`, {
    token,
    method: 'PATCH',
    body: { status },
  })
}

export function archiveUser(token, userId) {
  return apiRequest(`/api/users/${userId}/archive`, {
    token,
    method: 'PATCH',
  })
}
