/**
 * AnimatedTrashButton
 * Clean, container-free action button with an animated Lucide trash icon.
 * Left-hinged lid anchored at bottom-left corner (4px, 6px) that lifts upward (-35deg).
 */
export function AnimatedTrashButton({
  onClick,
  title = 'Delete break',
  ariaLabel,
  disabled = false,
  size = 16,
  className = '',
  ...props
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
      disabled={disabled}
      className={`animated-trash-btn ${className}`.trim()}
      {...props}
    >
      <svg
        style={{ width: size, height: size, overflow: 'visible' }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animated-trash-icon"
        aria-hidden="true"
      >
        <g className="trash-lid">
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <line x1="3" y1="6" x2="21" y2="6" />
        </g>

        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  )
}

export default AnimatedTrashButton
