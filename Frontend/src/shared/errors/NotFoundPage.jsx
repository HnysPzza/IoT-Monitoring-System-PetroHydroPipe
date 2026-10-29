import { useContext } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { getRoleDashboardPath } from '../../features/auth/authNavigation.js'
import { AuthContext } from '../../features/auth/authSession.jsx'
import ErrorPageShell from './ErrorPageShell.jsx'

function NotFoundMascotIllustration() {
  return (
    <svg
      className="error-state-illustration"
      viewBox="880 310 680 490"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1338"
        y="362"
        width="36"
        height="156"
        className="error-illus-factory"
        strokeWidth="2.5"
      />
      <path
        d="M956 762V534L1078 442L1200 534L1314 448L1428 534V762Z"
        className="error-illus-factory"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect x="1378" y="644" width="24" height="28" rx="2" className="error-illus-window" />
      <rect x="1414" y="644" width="24" height="28" rx="2" className="error-illus-window" />
      <path d="M934 762H1620" className="error-illus-factory" strokeWidth="2" strokeLinecap="round" />

      <circle cx="1136" cy="382" r="4.5" fill="#f1ce6d" opacity="0.85" />
      <circle cx="1072" cy="614" r="3.5" fill="#8cc2e8" opacity="0.7" />
      <circle cx="1518" cy="434" r="3.5" fill="#8cc2e8" opacity="0.7" />
      <circle cx="1538" cy="654" r="4.5" fill="#f1ce6d" opacity="0.85" />
      <text x="1172" y="444" fontSize="34" fontWeight="700" fill="#8cc2e8" opacity="0.75">?</text>
      <text x="1335" y="380" fontSize="22" fontWeight="700" fill="#b7d4ea" opacity="0.7">?</text>

      <g transform="translate(938 690)">
        <rect x="0" y="0" width="84" height="62" rx="7" fill="#e6edf2" stroke="#bccad4" strokeWidth="2.5" />
        <path d="M10 12H74" stroke="#f8fafb" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M10 50H74" stroke="#d0dce4" strokeWidth="2" strokeLinecap="round" />

        <rect
          x="92"
          y="0"
          width="30"
          height="62"
          rx="6"
          fill="none"
          stroke="#6faed5"
          strokeWidth="2.5"
          strokeDasharray="5 5"
        />
        <path d="M107 6V56" stroke="#9ec5e0" strokeWidth="2" strokeDasharray="4 4" />

        <rect x="130" y="0" width="88" height="62" rx="7" fill="#e6edf2" stroke="#bccad4" strokeWidth="2.5" />
        <path d="M140 12H208" stroke="#f8fafb" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M140 50H208" stroke="#d0dce4" strokeWidth="2" strokeLinecap="round" />
      </g>

      <ellipse cx="1256" cy="762" rx="94" ry="10" fill="#dce7ef" opacity="0.6" />

      <g transform="translate(1156 404) scale(1.36)">
        <path d="M146 164L174 136" fill="none" stroke="#6faed5" strokeWidth="14" strokeLinecap="round" />
        <circle cx="152" cy="158" r="10" fill="#8cc2e8" stroke="#6faed5" strokeWidth="2" />
        <circle cx="202" cy="108" r="36" className="error-illus-blueprint" stroke="#6faed5" strokeWidth="8" />
        <path d="M180 90A24 24 0 0 1 206 82" fill="none" stroke="#dcecf7" strokeWidth="3" strokeLinecap="round" />
        <text x="202" y="124" textAnchor="middle" fontSize="46" fontWeight="700" fill="#6faed5">?</text>

        <rect x="0" y="52" width="148" height="196" rx="64" fill="#8cc2e8" />
        <rect x="18" y="84" width="112" height="94" rx="34" fill="#ffffff" />
        <path d="M40 108L60 103" fill="none" stroke="#2b465b" strokeWidth="3.8" strokeLinecap="round" />
        <path d="M84 103C91 96 101 96 107 103" fill="none" stroke="#2b465b" strokeWidth="3.8" strokeLinecap="round" />
        <ellipse cx="55" cy="124" rx="6.8" ry="8" fill="#2b465b" />
        <ellipse cx="93" cy="124" rx="6.8" ry="8" fill="#2b465b" />
        <ellipse cx="74" cy="152" rx="5" ry="6.5" fill="#2b465b" />

        <g transform="rotate(-4 74 42)">
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
    </svg>
  )
}

function canNavigateBackInHistory() {
  if (typeof window === 'undefined') return false
  if (typeof window.history.state?.idx === 'number') {
    return window.history.state.idx > 0
  }
  if (window.history.length <= 1) return false
  if (!document.referrer) return true

  try {
    return new URL(document.referrer).origin === window.location.origin
  } catch {
    return false
  }
}

export default function NotFoundPage() {
  const auth = useContext(AuthContext)
  const navigate = useNavigate()
  const dashboardPath = getRoleDashboardPath(auth?.user?.role)

  function handleGoBack() {
    if (canNavigateBackInHistory()) {
      window.history.back()
      return
    }
    navigate(dashboardPath, { replace: true })
  }

  return (
    <ErrorPageShell titleId="error-404-title" visual={<NotFoundMascotIllustration />}>
      <p className="error-state-eyebrow">PAGE NOT FOUND</p>
      <p className="error-state-code" aria-hidden="true">404</p>
      <h1 id="error-404-title" className="error-state-title">This page isn’t here</h1>
      <p className="error-state-description">
        The page may have been moved, renamed, or the link is wrong.
      </p>
      <div className="error-state-actions">
        <div className="error-state-action-row">
          <Link className="btn btn-secondary error-state-cta" to={dashboardPath}>
            <ArrowRight size={18} aria-hidden="true" />
            <span>Back to dashboard</span>
          </Link>
          <button
            type="button"
            className="btn btn-secondary error-state-cta error-state-cta-secondary"
            onClick={handleGoBack}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Go back</span>
          </button>
        </div>
      </div>
    </ErrorPageShell>
  )
}
