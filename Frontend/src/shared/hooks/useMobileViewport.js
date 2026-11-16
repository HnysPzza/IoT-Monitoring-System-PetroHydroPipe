import { useEffect, useState } from 'react'

/** Subscribe to a viewport media query so responsive-only UI mounts once cleanly. */
export function useMobileViewport(query = '(max-width: 900px)') {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches
  ))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined

    const mediaQuery = window.matchMedia(query)
    const updateViewport = () => setIsMobile(mediaQuery.matches)

    updateViewport()
    mediaQuery.addEventListener('change', updateViewport)

    return () => {
      mediaQuery.removeEventListener('change', updateViewport)
    }
  }, [query])

  return isMobile
}
