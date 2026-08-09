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

export function notifyUnauthorized(error, { token, path } = {}) {
  if (!token || token !== unauthorizedToken || error?.status !== 401 || !unauthorizedHandler) return

  try {
    unauthorizedHandler(error, { path })
  } catch {
    // Session recovery must not replace the original API failure.
  }
}
