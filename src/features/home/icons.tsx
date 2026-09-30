// Small stroke icons for the feature list. All decorative (aria-hidden).
import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="hm-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const PagesIcon = () => (
  <Icon>
    <rect x="7" y="3" width="11" height="15" rx="1.5" />
    <path d="M4 7v12.5A1.5 1.5 0 0 0 5.5 21H14" />
    <path d="M10 8h5M10 11h5M10 14h3" />
  </Icon>
)

export const PaceIcon = () => (
  <Icon>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2.5M9.5 2.5h5" />
  </Icon>
)

export const LockIcon = () => (
  <Icon>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
  </Icon>
)

export const CloudIcon = () => (
  <Icon>
    <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.4 9.1 4.7 4.7 0 0 0 7 18.5Z" />
    <path d="m9.5 14 2 2 3.5-3.5" />
  </Icon>
)

export const CoinIcon = () => (
  <Icon>
    <ellipse cx="12" cy="7" rx="7" ry="3" />
    <path d="M5 7v5c0 1.66 3.13 3 7 3s7-1.34 7-3V7M5 12v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5" />
  </Icon>
)

export const MoonIcon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Icon>
)

export const SpellIcon = () => (
  <Icon>
    <path d="m4 17 4-11 4 11M5.5 13h5" />
    <path d="m14 15 2.5 2.5L21 12" />
  </Icon>
)

export const StoryIcon = () => (
  <Icon>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    <path d="M7 8h1.5M15.5 8H17M15.5 11H17" />
  </Icon>
)

export const GlobeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z" />
  </Icon>
)
