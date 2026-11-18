/**
 * VeriScope mark: stacked layers (sources) with a lens at the top (the scope).
 * Single colour via currentColor; the lens cut-out uses the page background.
 */
export default function Logo({ size = 24, className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="VeriScope"
    >
      <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M16 4 28 11 16 18 4 11Z" fill="currentColor" />
        <path d="M4 16.5 16 23.5 28 16.5" />
        <path d="M4 22 16 29 28 22" opacity=".45" />
      </g>
      <circle cx="16" cy="11" r="3" fill="var(--bg)" />
    </svg>
  )
}
