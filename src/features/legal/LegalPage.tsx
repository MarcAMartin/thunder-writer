import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AppLogo } from '../../shell/AppLogo'
import { ThemeToggle } from '../../shell/ThemeToggle'
import { SUGGESTION_EMAIL } from '../feedback/sendSuggestion'
import { NEW_MANUSCRIPT_PATH, PRIVACY_PATH, TERMS_PATH } from '../home/routes'
import './legal.css'

/** Where questions about privacy and these terms go (the developer's inbox). */
export const CONTACT_EMAIL = SUGGESTION_EMAIL

/** The date both documents took effect; change it whenever either one changes. */
export const LEGAL_EFFECTIVE_DATE = 'October 8, 2026'

/** The layout shared by the Privacy Policy and the Terms of Service. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    const previous = document.title
    document.title = `${title} · Thunder Writer`
    return () => {
      document.title = previous
    }
  }, [title])

  // Arriving from the bottom of another page starts at the top, or at the linked section.
  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (target) target.scrollIntoView?.({ block: 'start' })
    else document.documentElement.scrollTop = 0
  }, [pathname, hash])

  return (
    <div className="lg-page">
      <header className="lg-header">
        <Link to="/" className="lg-brand" aria-label="Thunder Writer home">
          <AppLogo size={26} />
          Thunder Writer
        </Link>
        <nav className="lg-nav" aria-label="Legal">
          <NavLink to={PRIVACY_PATH} className="lg-nav-link">
            Privacy
          </NavLink>
          <NavLink to={TERMS_PATH} className="lg-nav-link">
            Terms
          </NavLink>
          <ThemeToggle />
        </nav>
      </header>

      <main className="lg-main">
        <article className="lg-article">
          <h1>{title}</h1>
          <p className="lg-effective">Effective {LEGAL_EFFECTIVE_DATE}</p>
          {children}
        </article>
      </main>

      <footer className="lg-footer">
        <span>
          Questions? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </span>
        <Link to={NEW_MANUSCRIPT_PATH} className="tw-btn tw-btn-primary">
          Start Writing
        </Link>
      </footer>
    </div>
  )
}

/** A section with an anchor, so a heading can be linked to (e.g. /privacy#google-drive). */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="lg-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  )
}

/** A link to another site, opened in a new tab. */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
