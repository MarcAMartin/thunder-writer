import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '../../shell/ThemeToggle'
import { isDriveConfigured, isPickerConfigured } from '../storage/driveSession'
import { BoltMark } from './BoltMark'
import { DemoPanel } from './DemoPanel'
import { HeroActions } from './HeroActions'
import {
  CloudIcon,
  CoinIcon,
  GlobeIcon,
  LockIcon,
  MoonIcon,
  PaceIcon,
  PagesIcon,
  SpellIcon,
  StoryIcon,
} from './icons'
import { IMPORT_LOCAL_PATH, NEW_MANUSCRIPT_PATH, OPEN_PICKER_PATH, SETTINGS_PATH } from './routes'
import './home.css'

interface Item {
  icon: ReactNode
  title: string
  body: string
  /** Shown instead of `body` in a build without Google Drive. */
  bodyWithoutDrive?: string
}

const IDEA_ITEMS: Item[] = [
  {
    icon: <SpellIcon />,
    title: 'Catches the small stuff',
    body: 'Grammar and spelling checks as you go, pinned to the exact words so you can see them in the page.',
  },
  {
    icon: <StoryIcon />,
    title: 'Thinks about the story',
    body: 'Contextual suggestions drawn from the whole manuscript — and from reference files you add, like an earlier book or a poem.',
  },
  {
    icon: <GlobeIcon />,
    title: 'Brings the world in',
    body: 'Relevant trivia and real-world details that might deepen a scene, offered as ideas, never as edits.',
  },
]

const FEATURES: Item[] = [
  {
    icon: <PagesIcon />,
    title: 'Book-size presets, true page breaks',
    body: 'Pick a trim size like 5 × 8 or 6 × 9 and see exactly where pages fall. Chapters can start on a fresh page, even after you change the font.',
  },
  {
    icon: <PaceIcon />,
    title: 'One or two suggestions at a time',
    body: 'A cooldown keeps the AI from getting chatty. Hide the pane completely when you are locked in and cruising.',
  },
  {
    icon: <LockIcon />,
    title: 'Private by design',
    body: 'Your API keys and files never touch our servers — there are none. Requests go straight from your browser to Claude or OpenAI.',
  },
  {
    icon: <CloudIcon />,
    title: 'Autosave, twice over',
    body: 'Every change is kept in this browser and, once you connect Google Drive, synced to your own Drive on change or on a timer.',
    bodyWithoutDrive: 'Every change is kept in this browser as you write, and you can save a copy to your computer any time.',
  },
  {
    icon: <CoinIcon />,
    title: 'Pennies, not dollars',
    body: 'Defaults to the lightest capable models, with a running AI cost total in the status bar.',
  },
  {
    icon: <MoonIcon />,
    title: 'Dark and light',
    body: 'Write at noon or at 2 a.m. Switch themes any time from the toolbar.',
  },
]

export function HomePage() {
  // Fixed at build time (the deployment's Google Cloud project), so plain calls are enough.
  const drive = isDriveConfigured()
  const pickerReady = isPickerConfigured()

  return (
    <div className="hm-root">
      <a className="hm-skip" href="#hm-main">
        Skip to content
      </a>

      <header className="hm-header">
        <div className="hm-container hm-header-inner">
          <Link to="/" className="hm-brand" aria-label="Thunder Writer home">
            <BoltMark size={30} />
            <span className="hm-brand-name">Thunder Writer</span>
          </Link>
          <nav className="hm-nav" aria-label="Primary">
            <Link to={SETTINGS_PATH} className="hm-nav-link">
              Settings
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="hm-main">
        <section className="hm-hero" aria-labelledby="hm-title">
          <div className="hm-container hm-hero-grid">
            <div className="hm-hero-copy">
              <p className="hm-eyebrow">For novelists</p>
              <h1 id="hm-title" className="hm-title">
                Thunder Writer
              </h1>
              <p className="hm-lead">
                An <span className="hm-lead-accent">idea processor</span>, not a word processor.
              </p>
              <p className="hm-intro">
                A word processor waits for you to finish a thought. Thunder Writer reads along as you
                draft and quietly surfaces what a good editor would: a grammar fix, a sharper phrase,
                a thread you dropped three chapters ago, a bit of history that fits the scene. You
                decide what stays.
              </p>

              <HeroActions />

              <p className="hm-fineprint">
                Already writing in Word or Google Docs?{' '}
                <Link to={IMPORT_LOCAL_PATH} className="hm-inline-link">
                  Import a manuscript
                </Link>
                {pickerReady && (
                  <>
                    {' '}
                    or{' '}
                    <Link to={OPEN_PICKER_PATH} className="hm-inline-link">
                      import it from Google Drive
                    </Link>
                  </>
                )}
                ; the original is never changed.
              </p>

              <p className="hm-fineprint">
                No account and no server. Your manuscript lives in this browser
                {drive ? ' and, once you connect it, your own Google Drive.' : '.'}
              </p>
            </div>

            <div className="hm-hero-demo">
              <DemoPanel />
            </div>
          </div>
        </section>

        <section className="hm-section" aria-labelledby="hm-idea-title">
          <div className="hm-container">
            <div className="hm-section-head">
              <h2 id="hm-idea-title" className="hm-h2">
                What makes it an idea processor
              </h2>
              <p className="hm-section-sub">
                The AI sits in a quiet pane beside your page. It never rewrites your prose on its own
                — every suggestion is a card you can take or leave.
              </p>
            </div>
            <ul className="hm-idea-grid">
              {IDEA_ITEMS.map((item) => (
                <li key={item.title} className="hm-idea-card">
                  <span className="hm-icon-wrap">{item.icon}</span>
                  <h3 className="hm-h3">{item.title}</h3>
                  <p className="hm-body">{item.body}</p>
                </li>
              ))}
            </ul>

            <div className="hm-control">
              <span className="hm-control-label">You stay in control</span>
              <ul className="hm-chips" aria-label="Actions on every suggestion">
                <li className="hm-chip hm-chip-accept">Accept</li>
                <li className="hm-chip">Decline</li>
                <li className="hm-chip">Mark done</li>
                <li className="hm-chip">Hide</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="hm-section hm-section-alt" aria-labelledby="hm-features-title">
          <div className="hm-container">
            <div className="hm-section-head">
              <h2 id="hm-features-title" className="hm-h2">
                Built for the long haul of a novel
              </h2>
            </div>
            <ul className="hm-feature-grid">
              {FEATURES.map((f) => (
                <li key={f.title} className="hm-feature">
                  <span className="hm-icon-wrap">{f.icon}</span>
                  <div>
                    <h3 className="hm-h3">{f.title}</h3>
                    <p className="hm-body">{drive ? f.body : (f.bodyWithoutDrive ?? f.body)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="hm-final" aria-labelledby="hm-final-title">
          <div className="hm-container hm-final-inner">
            <BoltMark size={40} />
            <h2 id="hm-final-title" className="hm-h2">
              The blank page is waiting.
            </h2>
            <p className="hm-section-sub">
              Start now — add your Claude or OpenAI key in Settings whenever you want suggestions.
            </p>
            <div className="hm-ctas hm-ctas-center">
              <Link to={NEW_MANUSCRIPT_PATH} className="tw-btn tw-btn-primary hm-cta hm-cta-primary">
                Start Writing
              </Link>
              <Link to={SETTINGS_PATH} className="tw-btn tw-btn-ghost hm-cta">
                Add an AI key
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="hm-footer">
        <div className="hm-container hm-footer-inner">
          <span>Thunder Writer runs entirely in your browser.</span>
          <Link to={SETTINGS_PATH} className="hm-nav-link">
            Settings
          </Link>
        </div>
      </footer>
    </div>
  )
}
