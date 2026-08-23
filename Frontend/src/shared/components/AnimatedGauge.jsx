export function AnimatedGauge({ size = 20, className = '', strokeWidth = 2, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`animated-gauge-icon ${className}`}
      {...props}
    >
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <path
        d="m12 14 4-4"
        className="gauge-needle"
        style={{ transformOrigin: '12px 14px' }}
      />
    </svg>
  )
}

export default AnimatedGauge
