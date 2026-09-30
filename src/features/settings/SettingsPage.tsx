import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_MODEL,
  SETTING_BOUNDS,
  googleClientId,
  projectNumberFromClientId,
  useSettings,
  type SettingsState,
} from '../../store/settings'
import type { AIProvider, ThemeMode } from '../../types'
import { clearAllLocalData } from '../storage/clearAll'
import { driveErrorMessage } from '../storage/drive'
import { loadConfigFromDrive, saveConfigToDrive } from '../storage/driveSession'
import { parseNumberField } from './fields'
import { testApiKey, type KeyTestResult } from './keyTest'
import './settings.css'

type Patch = Partial<Omit<SettingsState, 'set'>>

const ENV_CLIENT_ID = ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '').trim()
const envApiKey = () => ((import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? '').trim()

/** "Settings View": every change saves immediately to this browser. */
export function SettingsPage() {
  const s = useSettings()
  const [savedTick, setSavedTick] = useState(0)
  const location = useLocation()

  const save = (patch: Patch) => {
    s.set(patch)
    setSavedTick((t) => t + 1)
  }

  useEffect(() => {
    if (!location.hash) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView?.({ block: 'start' })
  }, [location.hash])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'

  return (
    <div className="st-page">
      <header className="st-header">
        <Link to="/" className="st-brand" aria-label="Thunder Writer home">
          <span className="st-bolt" aria-hidden="true">
            ⚡
          </span>
          Thunder Writer
        </Link>
        <Link to="/write" className="tw-btn tw-btn-primary st-back">
          ← Back to writing
        </Link>
      </header>

      <main className="st-main">
        <div className="st-intro">
          <h1>Settings</h1>
          <p>
            Everything here is saved instantly, in this browser only. Thunder Writer has no server: your keys go straight
            from this browser to the AI provider you pick, and your manuscripts stay here or in your own Google Drive.
          </p>
        </div>

        <Section id="ai" title="AI provider" lede="Which assistant writes your suggestions.">
          <RadioGroup<AIProvider>
            legend="Provider"
            value={s.provider}
            onChange={(provider) => save({ provider })}
            options={[
              { value: 'claude', label: 'Claude (Anthropic)', hint: 'Default. Haiku is fast and inexpensive.' },
              { value: 'openai', label: 'OpenAI (ChatGPT)', hint: 'Uses a low-cost model (gpt-6-luna) by default.' },
            ]}
          />
        </Section>

        <Section id="claude" title="Claude" lede="Used when Claude is the provider.">
          <ProviderFields
            provider="claude"
            active={s.provider === 'claude'}
            apiKey={s.claudeApiKey}
            model={s.claudeModel}
            defaultModel={DEFAULT_CLAUDE_MODEL}
            modelOptions={[DEFAULT_CLAUDE_MODEL, 'claude-sonnet-5-5']}
            keyPlaceholder="sk-ant-…"
            keyHelp={
              <>
                Create a key in the{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  Anthropic Console
                </a>
                .
              </>
            }
            modelHelp={`${DEFAULT_CLAUDE_MODEL} is the cheapest Claude model and plenty for suggestions.`}
            onKey={(claudeApiKey) => save({ claudeApiKey })}
            onModel={(claudeModel) => save({ claudeModel })}
          />
        </Section>

        <Section id="openai" title="OpenAI" lede="Used when OpenAI is the provider.">
          <ProviderFields
            provider="openai"
            active={s.provider === 'openai'}
            apiKey={s.openaiApiKey}
            model={s.openaiModel}
            defaultModel={DEFAULT_OPENAI_MODEL}
            modelOptions={[DEFAULT_OPENAI_MODEL, 'gpt-5-nano', 'gpt-4.1-nano', 'gpt-4.1-mini']}
            keyPlaceholder="sk-…"
            keyHelp={
              <>
                Create a key at{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                  platform.openai.com
                </a>
                .
              </>
            }
            modelHelp={`${DEFAULT_OPENAI_MODEL} is the low-cost current OpenAI default; gpt-5-nano is slightly cheaper per token.`}
            onKey={(openaiApiKey) => save({ openaiApiKey })}
            onModel={(openaiModel) => save({ openaiModel })}
          />
        </Section>

        <Section id="suggestions" title="Suggestions" lede="Keep the assistant helpful, not chatty.">
          <Toggle
            label="Suggest while I write"
            hint="When off, suggestions only come when you press Generate."
            checked={s.suggestionsEnabled}
            onChange={(suggestionsEnabled) => save({ suggestionsEnabled })}
          />
          <div className="st-grid">
            <NumberField
              label="Cooldown between requests"
              unit="seconds"
              {...SETTING_BOUNDS.suggestionCooldownSec}
              value={s.suggestionCooldownSec}
              onCommit={(suggestionCooldownSec) => save({ suggestionCooldownSec })}
              hint="Minimum gap between automatic requests."
            />
            <NumberField
              label="Wait after typing stops"
              unit="seconds"
              {...SETTING_BOUNDS.suggestionIdleSec}
              value={s.suggestionIdleSec}
              onCommit={(suggestionIdleSec) => save({ suggestionIdleSec })}
              hint="Only ask once you pause."
            />
            <NumberField
              label="Open suggestions at once"
              {...SETTING_BOUNDS.maxOpenSuggestions}
              integer
              value={s.maxOpenSuggestions}
              onCommit={(maxOpenSuggestions) => save({ maxOpenSuggestions })}
              hint="1–2 keeps you focused (default 2)."
            />
          </div>
          <Toggle
            label="Current-events trivia (web search)"
            hint={
              <>
                Now and then, the AI looks up one recent real-world item that may be relevant to your book, and the card
                links its sources. Costs about $0.01 per search on Claude or OpenAI, plus tokens, because search results
                count as input (OpenAI&apos;s gpt-4o-mini and gpt-4.1-mini add a fixed 8,000 input tokens per search). Each
                trivia attempt normally runs one search (on Claude, rarely two if a long search is resumed). Only trivia
                ever searches; grammar and style notes never do.
                <br />
                Privacy: when this is on, the provider may send short search queries derived from your manuscript to its
                search backend. When off, trivia comes only from the model&apos;s own knowledge.
              </>
            }
            checked={s.triviaWebSearch}
            onChange={(triviaWebSearch) => save({ triviaWebSearch })}
          />
          {s.triviaWebSearch && (
            <div className="st-grid">
              <NumberField
                label="Web-searched trivia at most every"
                unit="seconds"
                {...SETTING_BOUNDS.triviaCooldownSec}
                value={s.triviaCooldownSec}
                onCommit={(triviaCooldownSec) => save({ triviaCooldownSec })}
                hint="Default 600: at most one web-searched trivia attempt every 10 minutes, even across reloads and tabs."
              />
            </div>
          )}
        </Section>

        <Section id="drive" title="Google Drive" lede="Optional. Save manuscripts and preferences to your own Drive.">
          <TextField
            label="OAuth client ID"
            value={s.googleClientId}
            placeholder={ENV_CLIENT_ID ? `Using built-in ID ${ENV_CLIENT_ID.slice(0, 12)}…` : '1234567890-abc.apps.googleusercontent.com'}
            onChange={(googleClientId) => save({ googleClientId: googleClientId.trim() })}
            hint={
              ENV_CLIENT_ID
                ? 'Leave blank to use the client ID this copy of Thunder Writer was built with.'
                : 'Needed once so Google knows which app is asking.'
            }
            autoComplete="off"
          />
          <details className="st-details">
            <summary>How to get a client ID (about 3 minutes)</summary>
            <ol>
              <li>
                Open the{' '}
                <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                  Google Cloud Console
                </a>{' '}
                and create (or pick) a project.
              </li>
              <li>
                Under <em>APIs &amp; Services → Library</em>, enable the <strong>Google Drive API</strong>.
              </li>
              <li>
                Set up the <em>OAuth consent screen</em> (External is fine; add yourself as a test user).
              </li>
              <li>
                Under <em>Credentials</em>, create an <strong>OAuth client ID</strong> of type <strong>Web application</strong>.
              </li>
              <li>
                Add <code>{origin}</code>
                {origin !== 'http://localhost:5173' && (
                  <>
                    {' '}
                    (and <code>http://localhost:5173</code> for development)
                  </>
                )}{' '}
                as an <em>Authorized JavaScript origin</em>. No redirect URI is needed.
              </li>
              <li>Paste the client ID above.</li>
            </ol>
            <p className="st-hint">
              Thunder Writer asks only for the <code>drive.file</code> permission: it can see files it creates, never the
              rest of your Drive. Access lasts for this browser session.
            </p>
          </details>
          <PickerFields
            apiKey={s.googleApiKey}
            projectNumber={s.googleProjectNumber}
            clientId={googleClientId(s)}
            origin={origin}
            onApiKey={(googleApiKey) => save({ googleApiKey })}
            onProjectNumber={(googleProjectNumber) => save({ googleProjectNumber })}
          />
          <DriveConfigSync enabled={!!(s.googleClientId.trim() || ENV_CLIENT_ID)} />
          <NumberField
            label="Autosave to Drive at most every"
            unit="seconds"
            {...SETTING_BOUNDS.driveAutosaveSec}
            value={s.driveAutosaveSec}
            onCommit={(driveAutosaveSec) => save({ driveAutosaveSec })}
            hint="Also saves about 5 seconds after you pause. 0 = only after pauses."
          />
        </Section>

        <Section id="appearance" title="Appearance">
          <RadioGroup<ThemeMode>
            legend="Theme"
            value={s.theme}
            onChange={(theme) => save({ theme })}
            inline
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'Match system' },
            ]}
          />
        </Section>

        <Section id="data" title="Data in this browser" danger>
          <p className="st-hint">
            Removes every manuscript, context file, setting and API key stored in this browser. Files in Google Drive are
            not touched.
          </p>
          <ClearDataButton />
        </Section>
      </main>

      <SavedToast tick={savedTick} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  lede,
  danger,
  children,
}: {
  id: string
  title: string
  lede?: string
  danger?: boolean
  children: ReactNode
}) {
  const hId = `st-${id}-title`
  return (
    <section id={id} className={`st-card${danger ? ' st-card-danger' : ''}`} aria-labelledby={hId}>
      <div className="st-card-head">
        <h2 id={hId}>{title}</h2>
        {lede && <p>{lede}</p>}
      </div>
      <div className="st-card-body">{children}</div>
    </section>
  )
}

function RadioGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  inline,
}: {
  legend: string
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
  inline?: boolean
}) {
  const name = useId()
  return (
    <fieldset className={`st-radios${inline ? ' st-radios-inline' : ''}`}>
      <legend className="st-sr">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={`st-radio${value === o.value ? ' is-on' : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <span className="st-radio-label">{o.label}</span>
            {o.hint && <span className="st-hint">{o.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const id = useId()
  return (
    <div className="st-toggle-row">
      <div>
        <label htmlFor={id} className="st-label">
          {label}
        </label>
        {hint && (
          <div id={`${id}-hint`} className="st-hint">
            {hint}
          </div>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="st-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  autoComplete,
  list,
  onBlur,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  hint?: ReactNode
  placeholder?: string
  autoComplete?: string
  list?: string
}) {
  const id = useId()
  return (
    <div className="st-field">
      <label htmlFor={id} className="st-label">
        {label}
      </label>
      <input
        id={id}
        className="st-input"
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        list={list}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <div id={`${id}-hint`} className="st-hint">
          {hint}
        </div>
      )}
    </div>
  )
}

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  integer,
  hint,
  onCommit,
}: {
  label: string
  unit?: string
  value: number
  min: number
  max: number
  integer?: boolean
  hint?: string
  onCommit: (v: number) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    const v = parseNumberField(raw, min, max, integer)
    if (v !== null && v !== value) onCommit(v)
  }
  return (
    <div className="st-field">
      <label htmlFor={id} className="st-label">
        {label}
      </label>
      <div className="st-number">
        <input
          id={id}
          className="st-input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={integer ? 1 : 'any'}
          value={draft ?? String(value)}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = Number(e.target.value)
            // Commit while typing only when already in range; clamp on blur.
            if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) commit(e.target.value)
          }}
          onBlur={(e) => {
            commit(e.target.value)
            setDraft(null)
          }}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {unit && <span className="st-unit">{unit}</span>}
      </div>
      {hint && (
        <div id={`${id}-hint`} className="st-hint">
          {hint}
        </div>
      )}
    </div>
  )
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: ReactNode
}) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <div className="st-field">
      <label htmlFor={id} className="st-label">
        {label}
      </label>
      <div className="st-secret">
        <input
          id={id}
          className="st-input"
          type={shown ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim())}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          className="tw-btn"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          aria-controls={id}
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <div id={`${id}-hint`} className="st-hint">
          {hint}
        </div>
      )}
    </div>
  )
}

function ProviderFields(props: {
  provider: AIProvider
  active: boolean
  apiKey: string
  model: string
  defaultModel: string
  modelOptions: string[]
  keyPlaceholder: string
  keyHelp: ReactNode
  modelHelp: string
  onKey: (v: string) => void
  onModel: (v: string) => void
}) {
  const listId = useId()
  const [test, setTest] = useState<(KeyTestResult & { pending?: false }) | { pending: true } | null>(null)
  const name = props.provider === 'claude' ? 'Claude' : 'OpenAI'

  const runTest = async () => {
    setTest({ pending: true })
    try {
      setTest(await testApiKey(props.provider, props.apiKey, props.model || props.defaultModel))
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : 'Key test failed.' })
    }
  }

  return (
    <>
      {props.active && <p className="st-badge">Active provider</p>}
      <SecretField
        label={`${name} API key`}
        value={props.apiKey}
        placeholder={props.keyPlaceholder}
        onChange={(v) => {
          setTest(null)
          props.onKey(v)
        }}
        hint={
          <>
            Stored only in this browser (localStorage) and sent directly to {name}. {props.keyHelp}
          </>
        }
      />
      <div className="st-row">
        <button type="button" className="tw-btn" onClick={runTest} disabled={!props.apiKey || (test?.pending ?? false)}>
          {test?.pending ? 'Testing…' : 'Test key'}
        </button>
        <span className="st-test" role="status" aria-live="polite">
          {test && !test.pending && (
            <span className={test.ok ? 'st-ok' : 'st-bad'}>
              {test.ok ? '✓ ' : '✕ '}
              {test.message}
            </span>
          )}
        </span>
      </div>
      <TextField
        label="Model"
        value={props.model}
        onChange={(v) => props.onModel(v.trim())}
        onBlur={() => {
          if (!props.model.trim()) props.onModel(props.defaultModel)
        }}
        list={listId}
        autoComplete="off"
        hint={
          <>
            {props.modelHelp}
            {props.model !== props.defaultModel && (
              <>
                {' '}
                <button type="button" className="st-link" onClick={() => props.onModel(props.defaultModel)}>
                  Use {props.defaultModel}
                </button>
              </>
            )}
          </>
        }
      />
      <datalist id={listId}>
        {props.modelOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  )
}

/** Google Picker credentials, for importing existing Drive files (Google Docs, Word, text). */
function PickerFields(props: {
  apiKey: string
  projectNumber: string
  clientId: string
  origin: string
  onApiKey: (v: string) => void
  onProjectNumber: (v: string) => void
}) {
  const envKey = envApiKey()
  const derived = projectNumberFromClientId(props.clientId)
  const effective = props.projectNumber.trim() || derived
  const origins = [props.origin, ...(props.origin !== 'http://localhost:5173' ? ['http://localhost:5173'] : [])]
  return (
    <>
      <SecretField
        label="Google API key (for importing from Drive)"
        value={props.apiKey}
        placeholder={envKey ? `Using built-in key ${envKey.slice(0, 8)}…` : 'AIza…'}
        onChange={props.onApiKey}
        hint={
          <>
            Lets you pick an existing Google Doc, Word, text, Markdown or HTML file from anywhere in your Drive and import
            it as a new manuscript (the original is never changed). Stored only in this browser and never synced to Drive.
            {envKey && ' Leave blank to use the key this copy of Thunder Writer was built with.'}
          </>
        }
      />
      <TextField
        label="Google Cloud project number"
        value={props.projectNumber}
        placeholder={derived ? `${derived} (from your client ID)` : '123456789012'}
        onChange={(v) => props.onProjectNumber(v.replace(/\s+/g, ''))}
        autoComplete="off"
        hint={
          effective
            ? props.projectNumber.trim()
              ? `Using ${effective}. Leave blank to use the number from your client ID${derived ? ` (${derived})` : ''}.`
              : `Using ${effective}, the number at the start of your client ID. Only change this if your client ID comes from a different project.`
            : 'Found at the start of your OAuth client ID, or on the Cloud Console dashboard.'
        }
      />
      <details className="st-details">
        <summary>How to set up importing from Drive (about 2 minutes)</summary>
        <ol>
          <li>
            In the same{' '}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              Google Cloud Console
            </a>{' '}
            project as your client ID, open <em>APIs &amp; Services → Library</em> and enable the{' '}
            <strong>Google Picker API</strong>.
          </li>
          <li>
            Under <em>Credentials</em>, choose <em>Create credentials → API key</em>.
          </li>
          <li>
            Edit the key. Under <em>Application restrictions</em> pick <strong>Websites</strong> and add{' '}
            {origins.map((o) => (
              <span key={o}>
                <code>{o}/*</code>,{' '}
              </span>
            ))}
            and <code>https://docs.google.com/*</code> (the Picker runs in a frame on docs.google.com, and Google rejects
            the key without it).
          </li>
          <li>
            Under <em>API restrictions</em>, choose <em>Restrict key</em> and select only the <strong>Google Picker API</strong>.
          </li>
          <li>Paste the key above. The project number fills itself in from your client ID.</li>
        </ol>
        <p className="st-hint">
          The Picker keeps the <code>drive.file</code> permission: Thunder Writer can open only the files you pick, never
          browse the rest of your Drive. The key identifies the app to Google; it can&apos;t read your files by itself.
          You can also set <code>VITE_GOOGLE_API_KEY</code> in <code>.env.local</code> at build time.
        </p>
      </details>
    </>
  )
}

/** Sync non-secret preferences through the writer's own Drive. */
function DriveConfigSync({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: true })
  const run = async (kind: 'save' | 'load') => {
    setState({ busy: true, msg: null, ok: true })
    try {
      if (kind === 'save') {
        await saveConfigToDrive()
        setState({ busy: false, msg: 'Preferences saved to Drive.', ok: true })
      } else {
        const cfg = await loadConfigFromDrive()
        setState({ busy: false, msg: cfg ? 'Preferences loaded from Drive.' : 'No saved preferences in Drive yet.', ok: !!cfg })
      }
    } catch (e) {
      setState({ busy: false, msg: driveErrorMessage(e), ok: false })
    }
  }
  return (
    <div className="st-field">
      <span className="st-label">Sync preferences</span>
      <div className="st-row">
        <button type="button" className="tw-btn" disabled={!enabled || state.busy} onClick={() => run('save')}>
          Save to Drive
        </button>
        <button type="button" className="tw-btn" disabled={!enabled || state.busy} onClick={() => run('load')}>
          Load from Drive
        </button>
        <span className="st-test" role="status" aria-live="polite">
          {state.msg && <span className={state.ok ? 'st-ok' : 'st-bad'}>{state.msg}</span>}
        </span>
      </div>
      <div className="st-hint">
        {enabled
          ? 'Theme, provider, models, cadence and trivia settings travel with you. API keys are never uploaded.'
          : 'Add a client ID above to sync preferences.'}
      </div>
    </div>
  )
}

function ClearDataButton() {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    if (
      !window.confirm(
        'Delete all Thunder Writer data in this browser? Manuscripts not saved to Google Drive will be lost, and your API keys will be removed.',
      )
    )
      return
    setBusy(true)
    await clearAllLocalData()
    window.location.assign('/')
  }
  return (
    <button type="button" className="tw-btn st-danger-btn" onClick={onClick} disabled={busy}>
      {busy ? 'Clearing…' : 'Clear all local data'}
    </button>
  )
}

function SavedToast({ tick }: { tick: number }) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (tick === 0) return
    setVisible(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), 1600)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [tick])
  return (
    <div className="st-toast-slot" role="status" aria-live="polite">
      {visible && <span className="st-toast">✓ Saved</span>}
    </div>
  )
}
