import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import ErrorPageShell from '../errors/ErrorPageShell.jsx'
import { useAuth } from '../hooks/useAuth.js'

function ForbiddenMascotIllustration() {
  return (
    <svg
      className="error-state-illustration"
      viewBox="880 310 660 490"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1440"
        y="386"
        width="34"
        height="134"
        className="error-illus-factory"
        strokeWidth="2.5"
      />
      <path
        d="M970 780V520L1060 452L1150 520L1240 452L1330 520L1420 452L1510 520V780Z"
        className="error-illus-factory"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect x="1390" y="627" width="28" height="32" className="error-illus-window" />
      <rect x="1440" y="627" width="28" height="32" className="error-illus-window" />
      <g transform="rotate(110 1415 520)">
        <g transform="translate(1205 489)">
          <path d="M12 0H422V62H12A12 31 0 0 1 12 0Z" fill="#e2e9ed" stroke="#cbd5dc" strokeWidth="3" />
          <path d="M20 9H414" fill="none" stroke="#f8fafb" strokeWidth="4" strokeLinecap="round" />
          <path d="M20 53H414" fill="none" stroke="#d0d9de" strokeWidth="2" />
          <ellipse cx="420" cy="31" rx="12" ry="31" fill="#edf2f4" stroke="#cbd5dc" strokeWidth="3" />
          <ellipse cx="420" cy="31" rx="6" ry="20" fill="#cbd5dc" stroke="#bcc9d1" strokeWidth="2" />
        </g>
      </g>
      <g transform="translate(28 0)">
        <g transform="rotate(-5 980 635)">
          <rect x="902" y="526" width="156" height="218" rx="4" className="error-illus-blueprint" strokeWidth="2.5" />
          <text x="917" y="548" fontSize="9" fontWeight="700" letterSpacing="0.7" fill="#668fa8">
            STEEL TUBE
          </text>
          <path d="M917 557H1043" stroke="#bed4e1" strokeWidth="1.5" />
          <path d="M924 584H1022V611H924Z" fill="none" stroke="#7fa9c1" strokeWidth="2" />
          <path d="M931 591H1015M931 604H1015" fill="none" stroke="#7fa9c1" strokeWidth="1.5" />
          <ellipse cx="924" cy="597.5" rx="7" ry="13.5" fill="#edf5fa" stroke="#7fa9c1" strokeWidth="2" />
          <ellipse cx="1022" cy="597.5" rx="7" ry="13.5" fill="#edf5fa" stroke="#7fa9c1" strokeWidth="2" />
          <path d="M924 621V628M1022 621V628M924 625H1022" fill="none" stroke="#9ab8ca" strokeWidth="1.25" />
          <path d="M970 650V704M943 677H997" fill="none" stroke="#a4bfd0" strokeWidth="1.25" strokeDasharray="3 3" />
          <circle cx="970" cy="677" r="24" fill="none" stroke="#7fa9c1" strokeWidth="2" />
          <circle cx="970" cy="677" r="14" fill="none" stroke="#7fa9c1" strokeWidth="2" />
          <path d="M917 720H1043M917 725H960" fill="none" stroke="#bed4e1" strokeWidth="1.5" />
        </g>
      </g>
      <g transform="translate(1095 425) scale(1.45)">
        <path d="M4 153C-2 153-9 153-16 153" fill="none" stroke="#80bce0" strokeWidth="16" strokeLinecap="round" />
        <circle cx="-16" cy="153" r="9" fill="#91c5e8" stroke="#6faed5" strokeWidth="2" />
        <path
          d="M-14 147C-10 143-6 144-5 149M-14 159C-10 163-6 162-5 157"
          fill="none"
          stroke="#6faed5"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <rect x="0" y="40" width="178" height="190" rx="56" fill="#91c5e8" />
        <rect x="30" y="83" width="118" height="92" rx="34" fill="#ffffff" />
        <circle cx="67" cy="120" r="6.5" fill="#35546a" />
        <circle cx="111" cy="120" r="6.5" fill="#35546a" />
        <ellipse cx="89" cy="146" rx="7" ry="4" fill="#35546a" />
        <path d="M24 54C24 24 51 2 89 2s65 22 65 52H24Z" fill="#f1ce6d" />
        <path
          d="M89 6V48M55 17C48 26 43 37 43 48M123 17C130 26 135 37 135 48"
          fill="none"
          stroke="#dfbb61"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path d="M57 15C66 8 77 5 87 5" fill="none" stroke="#f8e3a0" strokeWidth="3" strokeLinecap="round" />
        <rect x="14" y="49" width="150" height="17" rx="8.5" fill="#f1ce6d" />
        <path d="M31 56H147" fill="none" stroke="#dfbb61" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export default function RequireRole({ roles, children }) {
  const { user } = useAuth()

  // Allows direct URL access only when the logged-in role is permitted.
  if (roles.includes(user?.role)) {
    return children
  }

  return (
    <ErrorPageShell titleId="error-403-title" visual={<ForbiddenMascotIllustration />}>
      <p className="error-state-eyebrow">403 · FORBIDDEN</p>
      <p className="error-state-code" aria-hidden="true">403</p>
      <h1 id="error-403-title" className="error-state-title">You don’t have access</h1>
      <p className="error-state-description">
        Your role can’t open this section. Return to your dashboard to continue.
      </p>
      <div className="error-state-actions">
        <Link className="btn btn-secondary error-state-cta" to="/dashboard">
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Back to dashboard</span>
        </Link>
        <p className="error-state-caption">Returns to Dashboard Overview</p>
      </div>
    </ErrorPageShell>
  )
}
