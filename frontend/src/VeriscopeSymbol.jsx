export function VeriscopeSymbol({ size = 48, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="VeriScope logo"
    >
      <defs>
        <linearGradient id="vs-dark-plane" x1="30" y1="20" x2="170" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B1D70" />
          <stop offset="100%" stopColor="#231145" />
        </linearGradient>
        <linearGradient id="vs-mid-plane" x1="25" y1="65" x2="175" y2="135" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="vs-prism-edge" x1="100" y1="115" x2="165" y2="165" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C084FC" />
          <stop offset="50%" stopColor="#9333EA" />
          <stop offset="100%" stopColor="#3B1D70" />
        </linearGradient>
        <linearGradient id="vs-blade-light" x1="70" y1="65" x2="135" y2="115" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="vs-blade-dark" x1="65" y1="85" x2="130" y2="135" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4C1D95" />
          <stop offset="100%" stopColor="#2E1065" />
        </linearGradient>
      </defs>
      <polygon points="100,92 172,136 100,180 28,136" fill="url(#vs-dark-plane)" />
      <polygon points="100,136 172,136 100,180" fill="url(#vs-prism-edge)" opacity="0.85" />
      <polygon points="100,56 172,100 100,144 28,100" fill="url(#vs-mid-plane)" />
      <polygon points="100,20 172,64 100,108 28,64" fill="url(#vs-dark-plane)" />
      <circle cx="100" cy="96" r="36" fill="#180B30" />
      <g transform="translate(100, 96)">
        {[0, 60, 120, 180, 240, 300].map((angle, index) => (
          <path
            key={angle}
            d="M -8,-14 L 18,-31 A 34,34 0 0,1 34,0 L 8,14 Z"
            fill={index % 2 === 0 ? 'url(#vs-blade-light)' : 'url(#vs-blade-dark)'}
            stroke="#180B30"
            strokeWidth="2"
            strokeLinejoin="round"
            transform={`rotate(${angle})`}
          />
        ))}
      </g>
      <circle cx="100" cy="96" r="14" fill="#FFFFFF" />
    </svg>
  )
}

export default VeriscopeSymbol
