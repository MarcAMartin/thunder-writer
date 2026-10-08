/**
 * Tip jar: a plain link to the developer's Venmo profile. No scripts, cookies
 * or tracking — nothing happens unless the writer clicks, and payment happens
 * entirely on Venmo. VITE_VENMO_HANDLE overrides the handle at build time.
 */

import type { ReactNode } from 'react'
import './support.css'

export const DEFAULT_VENMO_HANDLE = 'ThunderWriter'

const venmoHandle = () => {
  const v = import.meta.env.VITE_VENMO_HANDLE
  return (typeof v === 'string' && v.trim()) || DEFAULT_VENMO_HANDLE
}

/** Venmo profile URL for a handle, with or without its leading "@". */
export function venmoUrl(handle = venmoHandle()): string {
  const clean = handle.trim().replace(/^@/, '')
  return `https://venmo.com/u/${encodeURIComponent(clean)}`
}

export function venmoLabel(handle = venmoHandle()): string {
  return `@${handle.trim().replace(/^@/, '')}`
}

interface TipJarLinkProps {
  className?: string
  /** Visible text; defaults to "Tip jar". */
  children?: ReactNode
}

export function TipJarLink({ className, children }: TipJarLinkProps) {
  return (
    <a
      className={className}
      href={venmoUrl()}
      target="_blank"
      rel="noopener noreferrer"
      title={`Leave a tip for the developer on Venmo (${venmoLabel()}). Opens Venmo in a new tab`}
    >
      {children ?? (
        <>
          <span aria-hidden="true">☕</span> Tip jar
        </>
      )}
      <span className="su-sr"> (opens Venmo in a new tab)</span>
    </a>
  )
}
