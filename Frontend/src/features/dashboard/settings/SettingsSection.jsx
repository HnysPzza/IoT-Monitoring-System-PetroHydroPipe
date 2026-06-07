import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../../shared/session/ThemeContext.jsx'

export default function SettingsSection() {
  const { theme, setTheme } = useTheme()

  return (
    <section className="section-card settings-panel" aria-labelledby="settings-title">
      <div className="section-copy">
        <p className="section-eyebrow">System preferences</p>
        <h1 id="settings-title">Settings</h1>
        <p>Adjust the monitoring interface appearance for the current workstation.</p>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <h2>Interface theme</h2>
          <p>Switch between a high-contrast dark interface and a brighter light interface.</p>
        </div>

        <div className="theme-toggle" role="group" aria-label="Interface theme">
          <button
            className={`theme-option ${theme === 'dark' ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          >
            <Moon size={18} aria-hidden="true" />
            Dark
          </button>
          <button
            className={`theme-option ${theme === 'light' ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          >
            <Sun size={18} aria-hidden="true" />
            Light
          </button>
        </div>
      </div>
    </section>
  )
}
