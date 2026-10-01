import { useEffect, useId, useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { useEditorContext } from '../../shell/EditorContext'
import { useDocuments } from '../../store/documents'
import type { DocFormat } from '../../types'
import { SupportSlot } from '../support/SupportSlot'
import { useSettings } from '../../store/settings'
import { playStrike } from './typewriterSounds'
import { FocusModeButton, HeaderFooterButton, PreviewButton } from './BookTools'
import { HEADING_LABELS } from './editorExtensions'
import {
  BOOK_PRESETS,
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  resolveFormat,
} from './presets'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const mod = isMac ? '⌘' : 'Ctrl+'
const shift = isMac ? '⇧' : 'Shift+'

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3'
type Align = 'left' | 'center' | 'right' | 'justify'

interface ToolbarState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  highlight: boolean
  bulletList: boolean
  orderedList: boolean
  blockquote: boolean
  block: BlockType
  align: Align
  canUndo: boolean
  canRedo: boolean
}

function selectState(editor: Editor | null): ToolbarState | null {
  // Works off editor.state, which exists before the view mounts (don't gate on isDestroyed,
  // which is also true for a not-yet-mounted editor and would leave the toolbar stuck disabled).
  if (!editor) return null
  try {
    const block: BlockType = editor.isActive('heading', { level: 1 })
      ? 'h1'
      : editor.isActive('heading', { level: 2 })
        ? 'h2'
        : editor.isActive('heading', { level: 3 })
          ? 'h3'
          : 'paragraph'
    const align = (['center', 'right', 'justify'] as const).find((a) => editor.isActive({ textAlign: a })) ?? 'left'
    return {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      highlight: editor.isActive('highlight'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      blockquote: editor.isActive('blockquote'),
      block,
      align,
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }
  } catch {
    return null
  }
}

/* ------------------------------ icons ------------------------------ */

const PATHS: Record<string, ReactNode> = {
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  bullets: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" />
    </>
  ),
  numbers: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1.5v4M4 9h3M4 14.5c0-.8.7-1.5 1.5-1.5S7 13.7 7 14.5c0 1-3 1.8-3 3.5h3" strokeWidth="1.4" />
    </>
  ),
  quote: <path d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6" />,
  scene: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  left: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  center: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  right: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  justify: <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  marker: <path d="m9 15-3 3H4v-2l3-3m2 2 8.5-8.5a2.1 2.1 0 0 0-3-3L6 12m3 3-3-3M4 21h16" />,
}

function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="ed-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}

function ToolButton(props: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const title = props.shortcut ? `${props.label} (${props.shortcut})` : props.label
  return (
    <button
      type="button"
      className="ed-tool"
      aria-label={props.label}
      aria-pressed={props.active === undefined ? undefined : props.active}
      title={title}
      disabled={props.disabled}
      // Keep the writer's selection in the editor while clicking.
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

const Sep = () => <span className="ed-sep" aria-hidden="true" />

/* ------------------------------ toolbar ------------------------------ */

function useCurrentFormat() {
  const currentId = useDocuments((s) => s.currentId)
  const format = useDocuments((s) => (s.currentId ? s.docs[s.currentId]?.format : undefined))
  const updateFormat = useDocuments((s) => s.updateFormat)
  const patch = (p: Partial<DocFormat>) => {
    if (currentId) updateFormat(currentId, p)
  }
  return { format, resolved: resolveFormat(format), patch }
}

/**
 * `leading` starts the first row (the writer page puts File, Export
 * and Backups there), followed by Headers & footers… in the same button style.
 */
export function Toolbar({ leading }: { leading?: ReactNode } = {}) {
  const { editor } = useEditorContext()
  const st = useEditorState({ editor, selector: ({ editor: e }) => selectState(e) })
  const { format, resolved, patch } = useCurrentFormat()
  const ids = { block: useId(), preset: useId(), font: useId(), size: useId(), lh: useId(), chapter: useId(), sounds: useId() }
  const typewriter = useSettings((s) => s.typewriterSounds)
  const setSettings = useSettings((s) => s.set)
  const disabled = !editor || !st

  const run = (fn: (e: Editor) => void) => () => {
    if (editor) fn(editor)
  }

  const setBlock = (value: BlockType) =>
    run((e) => {
      const c = e.chain().focus()
      if (value === 'paragraph') c.setParagraph().run()
      else c.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run()
    })()

  const setAlign = (a: Align) =>
    run((e) => {
      if (a === 'left') e.chain().focus().unsetTextAlign().run()
      else e.chain().focus().setTextAlign(a).run()
    })

  const withCurrent = (options: number[], v: number) => (options.includes(v) ? options : [...options, v].sort((a, b) => a - b))
  const fontOptions = FONT_OPTIONS.some((f) => f.value === resolved.fontFamily)
    ? FONT_OPTIONS
    : [...FONT_OPTIONS, { label: resolved.fontFamily.split(',')[0].replace(/'/g, ''), value: resolved.fontFamily }]

  return (
    <div className="ed-toolbar" role="toolbar" aria-label="Formatting">
      <div className="ed-group ed-group-file">
        {leading}
        <HeaderFooterButton />
        <FocusModeButton />
      </div>
      <Sep />
      <div className="ed-group">
        <ToolButton label="Undo" shortcut={`${mod}Z`} disabled={disabled || !st?.canUndo} onClick={run((e) => e.chain().focus().undo().run())}>
          <Icon name="undo" />
        </ToolButton>
        <ToolButton label="Redo" shortcut={`${mod}${shift}Z`} disabled={disabled || !st?.canRedo} onClick={run((e) => e.chain().focus().redo().run())}>
          <Icon name="redo" />
        </ToolButton>
      </div>
      <Sep />
      <div className="ed-group">
        <label className="ed-sr" htmlFor={ids.block}>
          Paragraph style
        </label>
        <select
          id={ids.block}
          className="ed-select ed-select-block"
          value={st?.block ?? 'paragraph'}
          disabled={disabled}
          onChange={(e) => setBlock(e.target.value as BlockType)}
          title={`Paragraph style (Chapter: ${mod}Alt+1)`}
        >
          <option value="paragraph">Body text</option>
          <option value="h1">{HEADING_LABELS[1]}</option>
          <option value="h2">{HEADING_LABELS[2]}</option>
          <option value="h3">{HEADING_LABELS[3]}</option>
        </select>
      </div>
      <Sep />
      <div className="ed-group">
        <ToolButton label="Bold" shortcut={`${mod}B`} active={st?.bold ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleBold().run())}>
          <span className="ed-glyph ed-glyph-b">B</span>
        </ToolButton>
        <ToolButton label="Italic" shortcut={`${mod}I`} active={st?.italic ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleItalic().run())}>
          <span className="ed-glyph ed-glyph-i">I</span>
        </ToolButton>
        <ToolButton label="Underline" shortcut={`${mod}U`} active={st?.underline ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleUnderline().run())}>
          <span className="ed-glyph ed-glyph-u">U</span>
        </ToolButton>
        <ToolButton label="Strikethrough" shortcut={`${mod}${shift}S`} active={st?.strike ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleStrike().run())}>
          <span className="ed-glyph ed-glyph-s">S</span>
        </ToolButton>
        <ToolButton label="Highlight" shortcut={`${mod}${shift}H`} active={st?.highlight ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleHighlight().run())}>
          <Icon name="marker" />
        </ToolButton>
      </div>
      <Sep />
      <div className="ed-group">
        <ToolButton label="Bulleted list" shortcut={`${mod}${shift}8`} active={st?.bulletList ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleBulletList().run())}>
          <Icon name="bullets" />
        </ToolButton>
        <ToolButton label="Numbered list" shortcut={`${mod}${shift}7`} active={st?.orderedList ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleOrderedList().run())}>
          <Icon name="numbers" />
        </ToolButton>
        <ToolButton label="Block quote" shortcut={`${mod}${shift}B`} active={st?.blockquote ?? false} disabled={disabled} onClick={run((e) => e.chain().focus().toggleBlockquote().run())}>
          <Icon name="quote" />
        </ToolButton>
        <ToolButton label="Scene break" disabled={disabled} onClick={run((e) => e.chain().focus().setHorizontalRule().run())}>
          <Icon name="scene" />
        </ToolButton>
      </div>
      <Sep />
      <div className="ed-group" role="group" aria-label="Alignment">
        {(['left', 'center', 'right', 'justify'] as const).map((a) => (
          <ToolButton
            key={a}
            label={`Align ${a}`}
            shortcut={`${mod}${shift}${{ left: 'L', center: 'E', right: 'R', justify: 'J' }[a]}`}
            active={(st?.align ?? 'left') === a}
            disabled={disabled}
            onClick={setAlign(a)}
          >
            <Icon name={a} />
          </ToolButton>
        ))}
      </div>
      <Sep />
      <div className="ed-group ed-group-format" role="group" aria-label="Book format">
        <label className="ed-sr" htmlFor={ids.preset}>
          Book size
        </label>
        <select
          id={ids.preset}
          className="ed-select ed-select-preset"
          value={resolved.id}
          disabled={!format}
          title="Book size — sets trim, margins and type so page breaks are realistic"
          onChange={(e) =>
            patch({ presetId: e.target.value, fontFamily: undefined, fontSizePt: undefined, lineHeight: undefined })
          }
        >
          {BOOK_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="ed-sr" htmlFor={ids.font}>
          Book font
        </label>
        <select
          id={ids.font}
          className="ed-select ed-select-font"
          value={resolved.fontFamily}
          disabled={!format}
          title="Book font"
          onChange={(e) => patch({ fontFamily: e.target.value })}
        >
          {fontOptions.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <label className="ed-sr" htmlFor={ids.size}>
          Font size in points
        </label>
        <select
          id={ids.size}
          className="ed-select ed-select-num"
          value={String(resolved.fontSizePt)}
          disabled={!format}
          title="Font size (pt)"
          onChange={(e) => patch({ fontSizePt: Number(e.target.value) })}
        >
          {withCurrent(FONT_SIZE_OPTIONS, resolved.fontSizePt).map((n) => (
            <option key={n} value={String(n)}>
              {n} pt
            </option>
          ))}
        </select>
        <label className="ed-sr" htmlFor={ids.lh}>
          Line spacing
        </label>
        <select
          id={ids.lh}
          className="ed-select ed-select-num"
          value={String(resolved.lineHeight)}
          disabled={!format}
          title="Line spacing"
          onChange={(e) => patch({ lineHeight: Number(e.target.value) })}
        >
          {withCurrent(LINE_HEIGHT_OPTIONS, resolved.lineHeight).map((n) => (
            <option key={n} value={String(n)}>
              {n.toFixed(2).replace(/0$/, '')}×
            </option>
          ))}
        </select>
        <label className="ed-check" htmlFor={ids.chapter} title="Every Chapter heading starts at the top of a new page, even when the font or size changes">
          <input
            id={ids.chapter}
            type="checkbox"
            checked={resolved.chapterStartsNewPage}
            disabled={!format}
            onChange={(e) => patch({ chapterStartsNewPage: e.target.checked })}
          />
          <span>Chapters start new page</span>
        </label>
      </div>
      <div className="ed-group">
        <label className="ed-check" htmlFor={ids.sounds} title="A key strike as you type, and a softer knock when you delete">
          <input
            id={ids.sounds}
            type="checkbox"
            checked={typewriter}
            onChange={(e) => {
              setSettings({ typewriterSounds: e.target.checked })
              // A sample, so turning it on is heard at once (the click lets the browser start audio).
              if (e.target.checked) playStrike()
            }}
          />
          <span>Typewriter sounds</span>
        </label>
      </div>
      <div className="ed-group ed-group-preview">
        <SupportSlot />
        <PreviewButton editor={editor} />
      </div>
    </div>
  )
}

/** Inline-editable manuscript title. Commits on blur / Enter, reverts on Escape. */
export function DocTitle() {
  const currentId = useDocuments((s) => s.currentId)
  const title = useDocuments((s) => (s.currentId ? s.docs[s.currentId]?.title ?? '' : ''))
  const updateTitle = useDocuments((s) => s.updateTitle)
  const [draft, setDraft] = useState(title)
  const id = useId()

  useEffect(() => setDraft(title), [title, currentId])

  const commit = () => {
    const next = draft.trim() || 'Untitled Manuscript'
    if (currentId && next !== title) updateTitle(currentId, next)
    setDraft(next)
  }

  return (
    <>
      <label className="ed-sr" htmlFor={id}>
        Manuscript title
      </label>
      <input
        id={id}
        className="ed-title"
        value={draft}
        disabled={!currentId}
        spellCheck={false}
        maxLength={200}
        size={Math.min(40, Math.max(12, draft.length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(title)
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
          }
        }}
      />
    </>
  )
}
