// Small inline icons. Decorative (aria-hidden); buttons carry their own labels.

export function BoltIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="sg-icon sg-bolt" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M13.5 2 4 13.5h6.5L9 22l10-12.5h-6.8L13.5 2Z" fill="currentColor" />
    </svg>
  )
}

export function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className="sg-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={direction === 'right' ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
