interface BoltMarkProps {
  size?: number
  className?: string
}

/**
 * A small lightning bolt on a soft tile, used inside the Home page's demo window
 * (where the full app icon would be too detailed). Decorative. The brand logo is
 * shell/AppLogo.
 */
export function BoltMark({ size = 28, className }: BoltMarkProps) {
  return (
    <svg
      className={className ? `hm-bolt ${className}` : 'hm-bolt'}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" className="hm-bolt-tile" />
      <path
        d="M18.6 4.5 8.2 18.1h6.6L12.9 27.5l11-14.4h-6.7l1.4-8.6Z"
        className="hm-bolt-path"
        strokeLinejoin="round"
      />
    </svg>
  )
}
