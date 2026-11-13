import { useState } from 'react'
import { Eye, EyeOff, Lock, Zap } from 'lucide-react'

// Renders the shared industrial split layout and PetroHydroPipe facility panel for auth routes.
export function AuthShell({
  brandLabel = 'System information',
  brandPoints = null,
  cardKey,
  children,
  pageClassName = '',
  panelLabelledBy,
  subtitle = 'PetroHydroPipe · Dunggoan, Danao City, Cebu',
  title = 'IoT Machine Monitoring System',
}) {
  return (
    <main className={`login-page ${pageClassName}`.trim()}>
      <section className="brand-panel" aria-label={brandLabel}>
        <div className="brand-content">
          <div className="brand-logo-row">
            <img
              className="brand-logo"
              src="/assets/logo.png"
              alt="PetroHydroPipe logo"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
            <div className="logo-fallback" aria-hidden="true">
              <Zap size={20} />
              <span>PetroHydroPipe</span>
            </div>
          </div>

          <div className="brand-identity">
            <p className="system-title">{title}</p>
            <p className="facility">{subtitle}</p>
          </div>

          {brandPoints}
        </div>
      </section>

      <section className="form-panel" aria-labelledby={panelLabelledBy}>
        <div key={cardKey} className="login-card">
          {children}
        </div>
      </section>
    </main>
  )
}

// Renders a password field with leading icon, 44px visibility toggle, Caps Lock hint, and error state.
export function PasswordInput({
  autoComplete,
  disabled = false,
  errorMessage = '',
  errorRole = 'alert',
  hasError = false,
  icon: Icon = Lock,
  id,
  inputRef,
  label,
  maxLength,
  minLength,
  name,
  onAnimationEnd,
  onBlur,
  onChange,
  placeholder,
  required = true,
  shake = false,
  value,
}) {
  const [visible, setVisible] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const fieldName = name || id
  const errorId = `${id}-error`
  const capsId = `${id}-caps-warning`
  const visibilityLabel = `${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`
  const describedBy = [
    hasError && errorMessage ? errorId : '',
    capsLockOn ? capsId : '',
  ].filter(Boolean).join(' ') || undefined

  function handleKeyEvent(event) {
    setCapsLockOn(Boolean(event.getModifierState?.('CapsLock')))
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div
        className={`input-shell has-toggle${hasError ? ' has-error' : ''}${shake ? ' shake' : ''}`}
        onAnimationEnd={onAnimationEnd}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setCapsLockOn(false)
          }
        }}
      >
        <Icon size={18} aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          name={fieldName}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          disabled={disabled}
          onChange={onChange}
          onBlur={onBlur}
          onKeyDown={handleKeyEvent}
          onKeyUp={handleKeyEvent}
          aria-invalid={Boolean(hasError)}
          aria-describedby={describedBy}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={visibilityLabel}
          aria-pressed={visible}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {hasError && errorMessage ? (
        <p className="field-error" id={errorId} role={errorRole}>
          {errorMessage}
        </p>
      ) : null}
      {capsLockOn ? (
        <p className="caps-warning" id={capsId} role="status">
          Caps Lock is active.
        </p>
      ) : null}
    </div>
  )
}
