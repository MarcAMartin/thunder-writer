import { AppLogo } from '../../shell/AppLogo'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  SETTING_BOUNDS,
  useSettings,
  type SettingsState,
} from '../../store/settings'
import type { AIProvider, ThemeMode } from '../../types'
import { clearAllLocalData } from '../storage/clearAll'
import { providerLabel } from '../suggestions/providers/types'
import { describeOpenRouterPrice, loadOpenRouterModels, type OpenRouterModel } from '../suggestions/providers/openrouterModels'
import { isDriveConfigured } from '../storage/driveSession'
import { parseNumberField } from './fields'
import { testApiKey, type KeyTestResult } from './keyTest'
import './settings.css'

type Patch = Partial<Omit<SettingsState, 'set'>>

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

  // Drive uses the deployment's own Google Cloud project; there is nothing for the writer to set up.
  const driveAvailable = isDriveConfigured()

  return (
    <div className="st-page">
      <header className="st-header">
        <Link to="/" className="st-brand" aria-label="Thunder Writer home">
          <AppLogo size={26} />
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
            from this browser to the AI provider you pick, and your manuscripts stay here
            {driveAvailable ? ' or in your own Google Drive.' : '.'}
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
              {
                value: 'openrouter',
                label: 'OpenRouter (any model)',
                hint: 'One key for hundreds of models from Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek and more.',
              },
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

        <Section id="openrouter" title="OpenRouter" lede="Used when OpenRouter is the provider. Pick any model in its catalog.">
          <OpenRouterFields
            active={s.provider === 'openrouter'}
            apiKey={s.openrouterApiKey}
            model={s.openrouterModel}
            onKey={(openrouterApiKey) => save({ openrouterApiKey })}
            onModel={(openrouterModel) => save({ openrouterModel })}
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
                ever searches; grammar and style notes never do. With OpenRouter there is no web search: trivia comes from the
                model&apos;s own knowledge.
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

        {driveAvailable && (
          <Section
            id="drive"
            title="Google Drive"
            lede="Once you connect Drive from the File menu, your manuscripts also save to a “Thunder Writer” folder in your own Drive."
          >
            <NumberField
              label="Autosave to Drive at most every"
              unit="seconds"
              {...SETTING_BOUNDS.driveAutosaveSec}
              value={s.driveAutosaveSec}
              onCommit={(driveAutosaveSec) => save({ driveAutosaveSec })}
              hint="Also saves about 5 seconds after you pause. 0 = only after pauses."
            />
          </Section>
        )}

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
            Removes every manuscript, backup, context file, setting and API key stored in this browser.
            {driveAvailable && ' Files in Google Drive are not touched.'}
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
  onFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  onFocus?: () => void
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
        onFocus={onFocus}
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
  /** Suggestions for the model box: ids, or ids with a label (name and price). */
  modelOptions: (string | { value: string; label: string })[]
  keyPlaceholder: string
  keyHelp: ReactNode
  modelHelp: ReactNode
  onKey: (v: string) => void
  onModel: (v: string) => void
  /** Called when the model box is focused (OpenRouter loads its catalog then). */
  onModelFocus?: () => void
}) {
  const listId = useId()
  const [test, setTest] = useState<(KeyTestResult & { pending?: false }) | { pending: true } | null>(null)
  const name = providerLabel(props.provider)

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
        onFocus={props.onModelFocus}
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
        {props.modelOptions.map((m) =>
          typeof m === 'string' ? <option key={m} value={m} /> : <option key={m.value} value={m.value} label={m.label} />,
        )}
      </datalist>
    </>
  )
}

/**
 * OpenRouter's catalog for the model box: loaded only once OpenRouter is in use
 * (it is the active provider, or the model box was focused), so other writers
 * never contact openrouter.ai.
 */
function useOpenRouterModels(wanted: boolean) {
  const [models, setModels] = useState<OpenRouterModel[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!wanted || models) return
    let live = true
    loadOpenRouterModels()
      .then((m) => live && setModels(m))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [wanted, models])
  return { models, failed }
}

function OpenRouterFields(props: {
  active: boolean
  apiKey: string
  model: string
  onKey: (v: string) => void
  onModel: (v: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const { models, failed } = useOpenRouterModels(props.active || focused)
  const chosen = models?.find((m) => m.id === (props.model || DEFAULT_OPENROUTER_MODEL)) ?? null
  const price = chosen ? describeOpenRouterPrice(chosen) : null
  const options = models
    ? models.map((m) => ({ value: m.id, label: [m.name, describeOpenRouterPrice(m)].filter(Boolean).join(' · ') }))
    : [DEFAULT_OPENROUTER_MODEL]

  return (
    <ProviderFields
      provider="openrouter"
      active={props.active}
      apiKey={props.apiKey}
      model={props.model}
      defaultModel={DEFAULT_OPENROUTER_MODEL}
      modelOptions={options}
      keyPlaceholder="sk-or-…"
      keyHelp={
        <>
          Create a key at{' '}
          <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
            openrouter.ai
          </a>{' '}
          and add credits there; OpenRouter bills you for what each model uses.
        </>
      }
      modelHelp={
        <>
          {chosen ? `${chosen.name}${price ? `: ${price}.` : '.'}` : null}
          {models && props.model && !chosen && 'Not in OpenRouter’s catalog. Check the id.'}
          {!models && !failed && (props.active || focused) && 'Loading OpenRouter’s models…'}
          {failed && 'Couldn’t load OpenRouter’s model list; you can still type a model id.'}{' '}
          Type to search, or browse{' '}
          <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">
            openrouter.ai/models
          </a>{' '}
          and paste a model id.
        </>
      }
      onKey={props.onKey}
      onModel={props.onModel}
      onModelFocus={() => setFocused(true)}
    />
  )
}

function ClearDataButton() {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    if (
      !window.confirm(
        isDriveConfigured()
          ? 'Delete all Thunder Writer data in this browser, including its backups? Manuscripts not saved to Google Drive will be lost, and your API keys will be removed.'
          : 'Delete all Thunder Writer data in this browser, including its backups? Your manuscripts will be lost unless you saved them to your computer, and your API keys will be removed.',
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
