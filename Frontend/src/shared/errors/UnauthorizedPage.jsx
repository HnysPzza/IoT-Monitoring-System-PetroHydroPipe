import { ArrowRight } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { getCurrentDashboardPath } from '../../features/auth/authNavigation.js'
import ErrorPageShell from './ErrorPageShell.jsx'

function UnauthorizedMascotIllustration() {
  return (
    <svg
      className="error-state-illustration"
      viewBox="880 310 680 490"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1282"
        y="366"
        width="36"
        height="152"
        className="error-illus-factory"
        strokeWidth="2.5"
      />
      <path
        d="M916 762V534L1034 442L1152 534L1268 446L1384 534L1474 462L1546 520V762Z"
        className="error-illus-factory"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M894 762H1568" className="error-illus-factory" strokeWidth="2" strokeLinecap="round" />

      <circle cx="1096" cy="382" r="4.5" fill="#f1ce6d" opacity="0.85" />
      <circle cx="964" cy="596" r="3.5" fill="#8cc2e8" opacity="0.7" />
      <circle cx="1518" cy="410" r="3.5" fill="#8cc2e8" opacity="0.7" />

      <g transform="rotate(-6 1028 604)">
        <rect
          x="972"
          y="508"
          width="112"
          height="168"
          rx="12"
          className="error-illus-blueprint"
          strokeWidth="2.5"
        />
        <rect x="1010" y="524" width="36" height="6" rx="3" fill="#9fb8ca" />
        <circle cx="1028" cy="574" r="23" fill="#dceaf4" stroke="#8fb3cb" strokeWidth="2" />
        <path
          d="M1011 591C1014 582 1020 578 1028 578S1042 582 1045 591"
          fill="#9ab9ce"
        />
        <text x="1028" y="576" textAnchor="middle" fontSize="22" fontWeight="700" fill="#52758d">?</text>
        <rect x="996" y="614" width="64" height="7" rx="3.5" fill="#b7ccdc" />
        <rect x="1008" y="630" width="40" height="6" rx="3" fill="#cadbe7" />
      </g>

      <ellipse cx="1212" cy="762" rx="94" ry="10" fill="#dce7ef" opacity="0.6" />

      <g transform="translate(1112 404) scale(1.36)">
        <path d="M4 146C-10 146 -22 142 -32 135" fill="none" stroke="#8cc2e8" strokeWidth="14" strokeLinecap="round" />
        <circle cx="-34" cy="134" r="9.5" fill="#6faed5" />

        <rect x="0" y="52" width="148" height="196" rx="64" fill="#8cc2e8" />
        <rect x="18" y="84" width="112" height="94" rx="34" fill="#ffffff" />
        <circle cx="54" cy="122" r="7.5" fill="#2b465b" />
        <circle cx="94" cy="122" r="7.5" fill="#2b465b" />
        <ellipse cx="74" cy="148" rx="5.5" ry="4.2" fill="#2b465b" />

        <g transform="translate(0 -2)">
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

      <g transform="translate(1386 490)">
        <path
          d="M28 76V44C28 20 46 2 68 2S108 20 108 44V76"
          fill="none"
          stroke="#94aebf"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <rect
          x="6"
          y="68"
          width="124"
          height="118"
          rx="22"
          fill="#e2ebf0"
          stroke="#bcccd6"
          strokeWidth="2.5"
        />
        <path d="M24 84H112" stroke="#f8fafb" strokeWidth="5" strokeLinecap="round" />
        <circle cx="68" cy="118" r="12" fill="#8bb0c8" />
        <rect x="62" y="122" width="12" height="26" rx="5" fill="#8bb0c8" />
      </g>
    </svg>
  )
}

export default function UnauthorizedPage() {
  const location = useLocation()
  const intendedRoute = getCurrentDashboardPath(location)
  const loginHref = intendedRoute !== '/dashboard'
    ? `/login?next=${encodeURIComponent(intendedRoute)}`
    : '/login'

  return (
    <ErrorPageShell titleId="error-401-title" visual={<UnauthorizedMascotIllustration />}>
      <p className="error-state-eyebrow">SIGN-IN REQUIRED</p>
      <p className="error-state-code" aria-hidden="true">401</p>
      <h1 id="error-401-title" className="error-state-title">Please sign in again</h1>
      <p className="error-state-description">
        Your session has expired or you’re not signed in. Sign in to pick up where you left off.
      </p>
      <div className="error-state-actions">
        <Link className="btn btn-secondary error-state-cta" to={loginHref} state={{ from: intendedRoute }}>
          <span>Sign In</span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </ErrorPageShell>
  )
}
