import { createContext, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

const THEME_STORAGE_KEY = 'iot_monitoring_theme'
export const ThemeContext = createContext(null)

// Starts from the saved theme, then uses the dashboard's light operational theme.
function getInitialTheme() {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)

  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }

  return 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme)
  const themeRef = useRef(theme)

  const setTheme = (nextThemeOrUpdater) => {
    const currentTheme = themeRef.current
    const nextTheme = typeof nextThemeOrUpdater === 'function'
      ? nextThemeOrUpdater(currentTheme)
      : nextThemeOrUpdater

    if (nextTheme === currentTheme) {
      return
    }

    themeRef.current = nextTheme

    const updateTheme = () => {
      const themeToApply = themeRef.current
      document.documentElement.dataset.theme = themeToApply
      setThemeState(themeToApply)
    }
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    if (typeof document.startViewTransition === 'function' && !prefersReducedMotion) {
      document.startViewTransition(() => flushSync(updateTheme))
      return
    }

    updateTheme()
  }

  // The CSS uses data-theme on <html> to switch dashboard colors.
  useEffect(() => {
    themeRef.current = theme
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
