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
