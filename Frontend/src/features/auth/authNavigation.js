import { navItems } from '../../shared/constants/dashboardMeta.js'

export const USER_ROLE_STORAGE_KEY = 'iot_monitoring_user_role'

export function getSafeDashboardPath(candidate, fallback = '/dashboard') {
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback
  }

  try {
    const parsed = new URL(candidate, window.location.origin)
    const isDashboardPath = parsed.pathname === '/dashboard' || parsed.pathname.startsWith('/dashboard/')

    if (parsed.origin !== window.location.origin || !isDashboardPath) {
      return fallback
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function getCurrentDashboardPath(location) {
  return getSafeDashboardPath(`${location.pathname}${location.search}${location.hash}`)
}

export function syncRoleHint(role) {
  try {
    if (typeof role === 'string' && role.trim()) {
      window.localStorage.setItem(USER_ROLE_STORAGE_KEY, role.trim())
      return
    }
    window.localStorage.removeItem(USER_ROLE_STORAGE_KEY)
  } catch {
    // Ignore storage errors in restricted browsing modes.
  }
}

function readCookieRoleHint() {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
    return null
  }

  const prefix = `${USER_ROLE_STORAGE_KEY}=`
  const match = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))

  return match ? decodeURIComponent(match.slice(prefix.length)) : null
}

export function getRoleDashboardPath(roleOverride) {
  try {
    const role = (
      roleOverride
      || window.localStorage.getItem(USER_ROLE_STORAGE_KEY)
      || readCookieRoleHint()
      || ''
    ).trim()

    if (!role) return '/dashboard'

    const matchedItem = navItems.find((item) => item.roles.includes(role))
    return getSafeDashboardPath(matchedItem?.to, '/dashboard')
  } catch {
    return '/dashboard'
  }
}
