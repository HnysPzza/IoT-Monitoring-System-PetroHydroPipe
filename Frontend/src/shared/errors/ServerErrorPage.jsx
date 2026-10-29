import { useContext } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { Link } from 'react-router'
import { getRoleDashboardPath } from '../../features/auth/authNavigation.js'
import { AuthContext } from '../../features/auth/authSession.jsx'
import ErrorPageShell from './ErrorPageShell.jsx'

function defaultReloadPage() {
  window.location.reload()
}

function ServerErrorMascotIllustration() {
  return (
    <svg
      className="error-state-illustration"
      viewBox="880 280 680 510"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="1272" cy="346" r="10" className="error-illus-window" opacity="0.55" />
      <circle cx="1286" cy="324" r="14" className="error-illus-window" opacity="0.45" />
      <circle cx="1306" cy="298" r="20" className="error-illus-window" opacity="0.35" />

      <rect
        x="1254"
        y="356"
        width="34"
        height="148"
        className="error-illus-factory"
        strokeWidth="2.5"
      />
      <path
        d="M936 742V506L1052 420L1168 506L1284 420L1400 506L1474 436L1548 506V742Z"
        className="error-illus-factory"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M902 742H1564" className="error-illus-factory" strokeWidth="2" strokeLinecap="round" />

      <circle cx="1096" cy="372" r="4.5" fill="#f1ce6d" opacity="0.85" />
      <circle cx="980" cy="558" r="3.5" fill="#8cc2e8" opacity="0.75" />

      <g transform="translate(918 666)">
        <path
          d="M0 4H106L96 20L108 36L94 52L104 68H0Z"
          fill="#e6edf2"
          stroke="#bccad4"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M10 14H88" stroke="#f8fafb" strokeWidth="3.5" strokeLinecap="round" />

        <path
          d="M150 0L140 18L152 34L138 50L148 68H204V0Z"
          fill="#e6edf2"
          stroke="#bccad4"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M156 12H194" stroke="#f8fafb" strokeWidth="3.5" strokeLinecap="round" />

        <path d="M126 -24L131 -8L147 -3L131 2L126 18L121 2L105 -3L121 -8Z" fill="#eab308" />
        <path d="M98 -32L101 -24L109 -21L101 -18L98 -10L95 -18L87 -21L95 -24Z" fill="#f1ce6d" />
        <path d="M156 -36L159 -28L167 -25L159 -22L156 -14L153 -22L145 -25L153 -28Z" fill="#f1ce6d" />

        <path d="M124 24C120 32 118 40 124 46C130 40 128 32 124 24Z" fill="#5da9dd" />
        <path d="M135 34C132 40 131 45 135 49C139 45 138 40 135 34Z" fill="#7ec0ec" />
        <ellipse cx="127" cy="70" rx="34" ry="5" fill="#bae0f7" opacity="0.8" />
      </g>

      <ellipse cx="1264" cy="742" rx="96" ry="10" fill="#dce7ef" opacity="0.65" />

      <g transform="translate(1152 384) scale(1.36)">
        <path d="M4 156L-36 164" fill="none" stroke="#8cc2e8" strokeWidth="14" strokeLinecap="round" />
        <circle cx="-38" cy="164" r="9.5" fill="#6faed5" />

        <g transform="translate(154 114) rotate(36)">
          <rect x="-4" y="0" width="9" height="46" rx="4" fill="#5d7285" />
          <path
            d="M-14 -14C-14 -24 14 -24 14 -14L9 4H-9Z"
            fill="#5d7285"
          />
          <circle cx="0" cy="-14" r="6" fill="#ffffff" />
        </g>
        <path d="M140 156L168 134" fill="none" stroke="#8cc2e8" strokeWidth="14" strokeLinecap="round" />

        <rect x="0" y="52" width="148" height="196" rx="64" fill="#8cc2e8" />
        <rect x="18" y="84" width="112" height="94" rx="34" fill="#ffffff" />

        <path d="M38 106L62 98" fill="none" stroke="#2b465b" strokeWidth="4" strokeLinecap="round" />
        <path d="M86 98L110 106" fill="none" stroke="#2b465b" strokeWidth="4" strokeLinecap="round" />
        <circle cx="54" cy="122" r="8" fill="#2b465b" />
        <circle cx="51.5" cy="119.5" r="2.2" fill="#ffffff" />
        <circle cx="94" cy="122" r="8" fill="#2b465b" />
        <circle cx="91.5" cy="119.5" r="2.2" fill="#ffffff" />
        <path
          d="M62 153Q68 146 74 153T86 153"
          fill="none"
          stroke="#2b465b"
          strokeWidth="3.8"
          strokeLinecap="round"
        />

        <path
          d="M138 86C133 96 132 104 138 109C144 104 143 96 138 86Z"
          fill="#bae0f7"
          stroke="#5da9dd"
          strokeWidth="2"
        />

        <g transform="rotate(-6 74 42)">
          <path d="M16 58C16 24 41 2 74 2S132 24 132 58H16Z" fill="#f1ce6d" />
          <path
            d="M74 6V52M44 17C38 27 34 39 34 52M104 17C110 27 114 39 114 52"
            fill="none"
            stroke="#dfbb61"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect x="8" y="52" width="132" height="16" rx="8" fill="#f1ce6d" />
          <path d="M22 59H126" fill="none" stroke="#dfbb61" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </g>

      <g transform="translate(1426 296) rotate(8 46 42)">
        <path
          d="M46 6L90 82H2Z"
          fill="#fdf2f2"
          stroke="#B83B3B"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <rect x="42.5" y="30" width="7" height="26" rx="3.5" fill="#B83B3B" />
        <circle cx="46" cy="68" r="4.2" fill="#B83B3B" />
      </g>
    </svg>
  )
}

export default function ServerErrorPage({
  onRetry,
  onNavigateHome,
  role,
  tabIndex,
  shellRef,
}) {
  const auth = useContext(AuthContext)
  const dashboardPath = getRoleDashboardPath(auth?.user?.role)
  const handleRetry = onRetry || defaultReloadPage

  return (
    <ErrorPageShell
      titleId="error-500-title"
      className="error-page--500"
      role={role}
      tabIndex={tabIndex}
      shellRef={shellRef}
      visual={<ServerErrorMascotIllustration />}
    >
      <p className="error-state-eyebrow">INTERNAL SERVER ERROR</p>
      <p className="error-state-code" aria-hidden="true">500</p>
      <h1 id="error-500-title" className="error-state-title">
        Something went wrong on our end.
      </h1>
      <p className="error-state-description">
        This isn’t something you did. Try reloading the page, or return to your dashboard to continue.
      </p>
      <div className="error-state-actions">
        <div className="error-state-action-row">
          <button
            type="button"
            className="btn btn-secondary error-state-cta"
            onClick={handleRetry}
          >
            <RotateCcw size={18} aria-hidden="true" />
            <span>Try again</span>
          </button>
          <Link
            className="btn btn-secondary error-state-cta error-state-cta-secondary"
            to={dashboardPath}
            onClick={onNavigateHome}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Back to dashboard</span>
          </Link>
        </div>
        <p className="error-state-caption">
          If this keeps happening, contact your administrator.
        </p>
      </div>
    </ErrorPageShell>
  )
}
