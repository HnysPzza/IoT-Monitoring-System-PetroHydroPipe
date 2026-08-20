import { forwardRef } from 'react'
import './panel-toggle.css'

/**
 * PanelToggle
 * A soft, minimalist toggle button using Lucide PanelLeftClose / PanelLeftOpen
 * with seamless CSS-animated chevron transitions.
 *
 * @param {boolean} isOpen - Whether the panel / drawer is open (chevron points left to close) or closed (chevron points right to open).
 * @param {boolean} isCollapsed - Convenience alias for desktop sidebar (isCollapsed=true means chevron points right to open).
 * @param {string} ariaLabel - Accessible label for screen readers.
 * @param {Function} onClick - Click handler.
 * @param {number} size - Icon dimension in px (default 20).
 * @param {string} className - Additional CSS classes.
 */
export const PanelToggle = forwardRef(function PanelToggle(
  {
    isOpen,
    isCollapsed,
    ariaLabel,
    'aria-label': ariaLabelProp,
    onClick,
    size = 20,
    className = '',
    type = 'button',
    ...props
  },
  ref
) {
  // Determine if pointing right (to open) vs pointing left (to close)
  // If isCollapsed is provided (sidebar mode): collapsed = true means closed (needs to open -> point right)
  // If isOpen is provided (drawer mode): open = false means closed (needs to open -> point right)
  const isPointingRight = isCollapsed !== undefined ? Boolean(isCollapsed) : !Boolean(isOpen)

  const computedAriaLabel =
    ariaLabelProp ||
    ariaLabel ||
    (isCollapsed !== undefined
      ? isCollapsed
        ? 'Expand sidebar'
        : 'Collapse sidebar'
      : isOpen
        ? 'Close navigation'
        : 'Open navigation')

  return (
    <button
      ref={ref}
      type={type}
      className={`panel-toggle-btn ${isPointingRight ? 'is-pointing-right' : 'is-pointing-left'} ${className}`.trim()}
      aria-label={computedAriaLabel}
      aria-expanded={isCollapsed !== undefined ? !isCollapsed : Boolean(isOpen)}
      onClick={onClick}
      {...props}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`lucide lucide-panel-left panel-toggle-svg ${isPointingRight ? 'lucide-panel-left-open is-open-icon' : 'lucide-panel-left-close is-close-icon'}`}
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" className="panel-rect" />
        <path d="M9 3v18" className="panel-divider" />
        <path d="m16 15-3-3 3-3" className="panel-chevron" />
      </svg>
    </button>
  )
})

export default PanelToggle
