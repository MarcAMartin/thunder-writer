import { useId, useState } from 'react'
import {
  resolveHeaderFooter,
  RUNNING_HEAD_PRESETS,
  runningHeadPresetId,
  type FooterContent,
  type HeadContent,
  type HeaderFooterSettings,
  type PageFurniture,
  type PageNumberPosition,
} from './headerFooter'

const HEAD_OPTIONS: { value: HeadContent; label: string }[] = [
  { value: 'author', label: 'Author name' },
  { value: 'title', label: 'Book title' },
  { value: 'chapter', label: 'Chapter title' },
  { value: 'custom', label: 'Custom text' },
  { value: 'none', label: 'Nothing' },
]

const FOOTER_OPTIONS: { value: FooterContent; label: string }[] = [
  { value: 'none', label: 'Nothing' },
  { value: 'title', label: 'Book title' },
  { value: 'author', label: 'Author name' },
  { value: 'custom', label: 'Custom text' },
]

const NUMBER_OPTIONS: { value: PageNumberPosition; label: string }[] = [
  { value: 'footer-center', label: 'Bottom, centred' },
  { value: 'footer-outside', label: 'Bottom, outside corner' },
  { value: 'header-outside', label: 'Top, outside corner' },
  { value: 'none', label: 'No page numbers' },
]

const SIZE_OPTIONS = [0.7, 0.75, 0.8, 0.9, 1]

export interface HeaderFooterPanelProps {
  value: HeaderFooterSettings
  onChange: (next: HeaderFooterSettings) => void
  /** Book title, used in the diagram. */
  title?: string
  /** A chapter title for the diagram. */
  sampleChapter?: string
  className?: string
}

/**
 * Header & footer options for the printed book, with a live diagram of a
 * spread. Controlled: value + onChange, so it can be bound to DocFormat.
 */
export function HeaderFooterPanel({ value, onChange, title = 'Book title', sampleChapter = 'Chapter One', className }: HeaderFooterPanelProps) {
  const id = useId()
  const [diagramOpener, setDiagramOpener] = useState(false)
  const set = <K extends keyof HeaderFooterSettings>(k: K, v: HeaderFooterSettings[K]) => onChange({ ...value, [k]: v })
  const presetId = runningHeadPresetId(value)
  const usesAuthor = [value.versoHead, value.rectoHead, value.footer].includes('author')

  return (
    <fieldset className={`bp-hf${className ? ` ${className}` : ''}`}>
      <legend className="bp-hf-legend">Headers &amp; footers</legend>

      <SpreadDiagram settings={value} title={title} chapter={sampleChapter} opener={diagramOpener} />
      <div className="bp-hf-seg" role="group" aria-label="Diagram shows">
        <button type="button" aria-pressed={!diagramOpener} onClick={() => setDiagramOpener(false)}>
          Text pages
        </button>
        <button type="button" aria-pressed={diagramOpener} onClick={() => setDiagramOpener(true)}>
          Chapter opening
        </button>
      </div>

      <div className="bp-hf-row">
        <label htmlFor={`${id}-preset`}>Running heads</label>
        <select
          id={`${id}-preset`}
          value={presetId}
          onChange={(e) => {
            const p = RUNNING_HEAD_PRESETS.find((x) => x.id === e.target.value)
            if (p) onChange({ ...value, versoHead: p.verso, rectoHead: p.recto })
          }}
        >
          {RUNNING_HEAD_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {presetId === 'custom' && <option value="custom">Custom</option>}
        </select>
      </div>

      <div className="bp-hf-pair">
        <div className="bp-hf-row">
          <label htmlFor={`${id}-verso`}>Left pages</label>
          <select id={`${id}-verso`} value={value.versoHead} onChange={(e) => set('versoHead', e.target.value as HeadContent)}>
            {HEAD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {value.versoHead === 'custom' && (
            <input
              aria-label="Left page custom text"
              type="text"
              value={value.versoCustom}
              maxLength={200}
              onChange={(e) => set('versoCustom', e.target.value)}
            />
          )}
        </div>
        <div className="bp-hf-row">
          <label htmlFor={`${id}-recto`}>Right pages</label>
          <select id={`${id}-recto`} value={value.rectoHead} onChange={(e) => set('rectoHead', e.target.value as HeadContent)}>
            {HEAD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {value.rectoHead === 'custom' && (
            <input
              aria-label="Right page custom text"
              type="text"
              value={value.rectoCustom}
              maxLength={200}
              onChange={(e) => set('rectoCustom', e.target.value)}
            />
          )}
        </div>
      </div>

      <div className="bp-hf-row">
        <label htmlFor={`${id}-author`}>Author name</label>
        <input
          id={`${id}-author`}
          type="text"
          value={value.authorName}
          maxLength={200}
          placeholder={usesAuthor ? 'Shown as the title until set' : 'Your name'}
          onChange={(e) => set('authorName', e.target.value)}
          autoComplete="name"
        />
      </div>

      <div className="bp-hf-pair">
        <div className="bp-hf-row">
          <label htmlFor={`${id}-num`}>Page numbers</label>
          <select id={`${id}-num`} value={value.pageNumbers} onChange={(e) => set('pageNumbers', e.target.value as PageNumberPosition)}>
            {NUMBER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="bp-hf-row">
          <label htmlFor={`${id}-first`}>First page number</label>
          <PageNumberInput
            id={`${id}-first`}
            value={value.firstPageNumber}
            onChange={(n) => set('firstPageNumber', n)}
            describedBy={`${id}-first-hint`}
          />
          <span className="bp-hf-hint" id={`${id}-first-hint`}>
            Odd numbers fall on right-hand pages.
          </span>
        </div>
      </div>

      <div className="bp-hf-row">
        <label htmlFor={`${id}-foot`}>Footer line</label>
        <select id={`${id}-foot`} value={value.footer} onChange={(e) => set('footer', e.target.value as FooterContent)}>
          {FOOTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {value.footer === 'custom' && (
          <input
            aria-label="Footer custom text"
            type="text"
            value={value.footerCustom}
            maxLength={200}
            placeholder="e.g. Advance reader copy, not for sale"
            onChange={(e) => set('footerCustom', e.target.value)}
          />
        )}
      </div>

      <div className="bp-hf-checks">
        <label className="bp-check">
          <input
            type="checkbox"
            checked={value.suppressOnChapterOpeners}
            onChange={(e) => set('suppressOnChapterOpeners', e.target.checked)}
          />
          No running head on chapter opening pages
        </label>
        {value.suppressOnChapterOpeners && value.pageNumbers !== 'none' && (
          <div className="bp-hf-row bp-hf-indent">
            <label htmlFor={`${id}-opener`}>Page number on chapter openings</label>
            <select id={`${id}-opener`} value={value.openerFolio} onChange={(e) => set('openerFolio', e.target.value === 'none' ? 'none' : 'drop')}>
              <option value="drop">At the foot of the page</option>
              <option value="none">Hidden</option>
            </select>
          </div>
        )}
        <label className="bp-check">
          <input type="checkbox" checked={value.suppressOnBlankPages} onChange={(e) => set('suppressOnBlankPages', e.target.checked)} />
          Nothing printed on blank pages
        </label>
        <label className="bp-check">
          <input type="checkbox" checked={value.smallCapsRunningHeads} onChange={(e) => set('smallCapsRunningHeads', e.target.checked)} />
          Small capitals for running heads
        </label>
      </div>

      <div className="bp-hf-row">
        <label htmlFor={`${id}-size`}>Header &amp; footer size</label>
        <select id={`${id}-size`} value={String(value.fontScale)} onChange={(e) => set('fontScale', Number(e.target.value))}>
          {(SIZE_OPTIONS.includes(value.fontScale) ? SIZE_OPTIONS : [...SIZE_OPTIONS, value.fontScale].sort()).map((v) => (
            <option key={v} value={String(v)}>
              {Math.round(v * 100)}% of body text
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  )
}

/** A number field that can be cleared while typing; only valid values (1–9999) are committed. */
function PageNumberInput({ id, value, onChange, describedBy }: { id: string; value: number; onChange: (n: number) => void; describedBy: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={9999}
      value={draft ?? String(value)}
      aria-describedby={describedBy}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isInteger(n) && n >= 1 && n <= 9999) onChange(n)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/* ------------------------------ diagram ------------------------------ */

const PW = 96
const PH = 138
const GAP = 0

function describe(side: string, f: PageFurniture) {
  const parts: string[] = []
  parts.push(f.headerText ? `running head “${f.headerText}”` : 'no running head')
  if (f.numberText) parts.push(`page number at the ${f.numberIn === 'header' ? 'top' : 'bottom'} ${f.align === 'center' ? 'centre' : f.align}`)
  else parts.push('no page number')
  if (f.footerText) parts.push(`footer “${f.footerText}”`)
  return `${side}: ${parts.join(', ')}`
}

/** Miniature spread: where running heads, footer text and page numbers will print. */
export function SpreadDiagram({
  settings,
  title,
  chapter,
  opener,
}: {
  settings: HeaderFooterSettings
  title: string
  chapter: string
  opener: boolean
}) {
  // A spread whose right page is odd, whatever the first page number.
  const base = settings.firstPageNumber % 2 === 0 ? 0 : 1
  const verso = resolveHeaderFooter(settings, { title }, { index: base, side: 'verso', chapterTitle: chapter, isChapterOpener: false, isBlank: false })
  const recto = resolveHeaderFooter(settings, { title }, {
    index: base + 1,
    side: 'recto',
    chapterTitle: chapter,
    isChapterOpener: opener,
    isBlank: false,
  })
  const label = `Spread diagram. ${describe('Left page', verso)}. ${describe(opener ? 'Right page (chapter opening)' : 'Right page', recto)}.`

  const page = (x: number, f: PageFurniture, isOpener: boolean) => {
    const inner = x + 14
    const w = PW - 28
    const tx = (slot: 'left' | 'center' | 'right') => (slot === 'left' ? inner : slot === 'right' ? inner + w : inner + w / 2)
    const anchor = (slot: 'left' | 'center' | 'right') => (slot === 'left' ? 'start' : slot === 'right' ? 'end' : 'middle')
    const lines: number[] = []
    const start = isOpener ? 62 : 26
    for (let y = start; y < PH - 22; y += 6) lines.push(y)
    const text = (slots: PageFurniture['header'], y: number, cls: string) =>
      (['left', 'center', 'right'] as const).map((k) =>
        slots[k] ? (
          <text key={k} x={tx(k)} y={y} textAnchor={anchor(k)} className={cls}>
            {slots[k].length > 18 ? `${slots[k].slice(0, 17)}…` : slots[k]}
          </text>
        ) : null,
      )
    return (
      <g>
        <rect x={x} y={0} width={PW} height={PH} className="bp-dg-page" />
        {text(f.header, 14, `bp-dg-head${f.smallCaps ? ' bp-dg-sc' : ''}`)}
        {isOpener && <rect x={inner + w / 2 - 18} y={46} width={36} height={4} rx={1} className="bp-dg-chapter" />}
        {lines.map((y, i) => (
          <rect key={y} x={inner} y={y} width={i % 7 === 6 ? w * 0.6 : w} height={2} className="bp-dg-line" />
        ))}
        {text(f.footer, PH - 8, 'bp-dg-foot')}
      </g>
    )
  }

  return (
    <svg className="bp-dg" viewBox={`-2 -2 ${PW * 2 + GAP + 4} ${PH + 4}`} role="img" aria-label={label}>
      {page(0, verso, false)}
      {page(PW + GAP, recto, opener)}
      <line x1={PW} y1={0} x2={PW} y2={PH} className="bp-dg-spine" />
    </svg>
  )
}
