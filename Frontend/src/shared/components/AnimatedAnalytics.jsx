export function AnimatedAnalytics({ size = 20, className = '', strokeWidth = 2, ...props }) {
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
      className={`lucide-chart-no-axes-combined animated-analytics-icon ${className}`.trim()}
      {...props}
    >
      {/* Static Vertical Bar Columns */}
      <g className="analytics-bars">
        <path d="M4 18.463V21" className="analytics-bar" />
        <path d="M8 14.656V21" className="analytics-bar" />
        <path d="M12 16v5" className="analytics-bar" />
        <path d="M16 14.639V21" className="analytics-bar" />
        <path d="M20 10.656V21" className="analytics-bar" />
      </g>

      {/* Dynamic Upward Trendline (Drawn upward from bottom-left to top-right) */}
      <path
        d="M2 15l6.646-6.646a.5.5 0 0 1 .708 0l3.292 3.292a.5.5 0 0 0 .708 0L22 3"
        className="analytics-trendline"
        pathLength="100"
      />
    </svg>
  )
}

export default AnimatedAnalytics
