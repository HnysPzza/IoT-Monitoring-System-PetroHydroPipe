import { formatDateOnly } from '../../../shared/utils/formatters.js'
import { getAccountStatusClass } from '../../../shared/utils/statusClasses.js'

export const initialUserForm = {
  name: '',
  username: '',
  email: '',
  role: '',
}

export function normalizeUsername(username) {
  return username.trim().toLowerCase()
}

export function validateAccount(values, accounts) {
  // Frontend validation gives quick feedback; backend repeats the critical checks.
  const errors = {}
  const username = normalizeUsername(values.username)
  const email = values.email.trim().toLowerCase()

  if (!values.name.trim()) {
    errors.name = 'Full name is required.'
  }

  if (!username) {
    errors.username = 'Username is required.'
  } else if (!/^[a-z0-9._-]+$/.test(username)) {
    errors.username = 'Use lowercase letters, numbers, dots, dashes, or underscores only.'
  } else if (accounts.some((account) => account.username.toLowerCase() === username)) {
    errors.username = 'This username already exists.'
  }

  if (!email) {
    errors.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.'
  } else if (accounts.some((account) => account.email?.toLowerCase() === email)) {
    errors.email = 'This email already exists.'
  }

  if (!values.role) {
    errors.role = 'Select a role.'
  }

  if (values.role === 'Admin') errors.role = 'The Admin account is protected.'

  return errors
}

export function formatDate(value) {
  return formatDateOnly(value)
}

export function getInitials(name, username) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return parts[0].slice(0, 2).toUpperCase()
  }
  if (username && username.trim()) {
    return username.trim().slice(0, 2).toUpperCase()
  }
  return 'U'
}

export { getAccountStatusClass }
