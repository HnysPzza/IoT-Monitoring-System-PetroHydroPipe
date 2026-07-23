import { createContext, useEffect, useState } from 'react'

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
  const [theme, setTheme] = useState(getInitialTheme)

  // The CSS uses data-theme on <html> to switch dashboard colors.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
