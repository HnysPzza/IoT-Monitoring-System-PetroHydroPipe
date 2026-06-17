import { Database, Factory, Moon, Server, Sun, Wifi } from 'lucide-react'
import { useTheme } from '../../../shared/hooks/useTheme.js'

const systemProfile = [
  { id: 'company', label: 'Company/System', value: 'PetroHydroPipe IoT Monitoring', icon: Factory },
  { id: 'backend', label: 'Backend Mode', value: 'Node/Express API', icon: Server },
  { id: 'machine', label: 'Current Machine Count', value: '1 machine', icon: Factory },
  { id: 'sensors', label: 'Sensor Count', value: '5 ESP32 sensors', icon: Wifi },
  { id: 'database', label: 'Database', value: 'Supabase PostgreSQL', icon: Database },
]

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
          {/* ThemeContext writes this choice to localStorage and <html data-theme>. */}
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

      <section className="settings-profile-section" aria-labelledby="system-profile-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">System profile</p>
            <h2 id="system-profile-title">Read-only deployment details</h2>
          </div>
        </div>

        <div className="settings-profile-grid">
          {systemProfile.map((item) => {
            const Icon = item.icon

            return (
              <article key={item.id} className="settings-profile-card">
                <span className="sidebar-link-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div>
                  <p>{item.label}</p>
                  <strong>{item.value}</strong>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </section>
  )
}
