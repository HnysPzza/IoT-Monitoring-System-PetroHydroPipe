let unauthorizedHandler = null
let unauthorizedToken = null

export function setUnauthorizedHandler(token, handler) {
  unauthorizedToken = token || null
  unauthorizedHandler = token && typeof handler === 'function' ? handler : null

  return () => {
    if (unauthorizedToken === token && unauthorizedHandler === handler) {
      unauthorizedToken = null
      unauthorizedHandler = null
    }
  }
}

function notifyMatchingSession(error, { token, path } = {}) {
  if (!token || token !== unauthorizedToken || !unauthorizedHandler) return

  try {
    unauthorizedHandler(error, { path })
  } catch {
    // Session recovery must not replace the original API failure.
  }
}

export function notifyUnauthorized(error, context = {}) {
  if (error?.status !== 401) return
  notifyMatchingSession(error, context)
}

export function notifyStreamAuthorizationLost(error, context = {}) {
  if (error?.status !== 401 && error?.status !== 403) return
  notifyMatchingSession(error, context)
}
