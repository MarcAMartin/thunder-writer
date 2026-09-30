# Thunder Writer

An **idea processor**, not a word processor. Thunder Writer is a browser-only
manuscript editor for novelists. You write on page-shaped sheets sized to a real
book trim (6 × 9, 5 × 8, standard manuscript…), and a quiet side pane offers one
or two AI suggestions at a time: grammar and spelling, contextual ideas drawn
from the whole manuscript and your reference files, and relevant trivia,
including current-events trivia that the AI looks up with its own web search
tool and shows with source links. You accept, decline, mark done or hide each
one.

There is **no backend**. Manuscripts live in your browser (IndexedDB) and,
optionally, your own Google Drive. AI calls go straight from your browser to
Claude or OpenAI with your own key.

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run build`     | Type-check (`tsc -b`) and build to `dist/`     |
| `npm run preview`   | Serve the production build locally            |
| `npm test`          | Run the Vitest suite once                      |
| `npm run typecheck` | Type-check only                                |

`dist/` is a static site; host it anywhere that serves files (with SPA
fallback to `index.html` so `/write` and `/settings` resolve).

## Routes

- `/`: home page with an animated demo, the **Start Writing** call to action,
  and **Import a manuscript** / **Open from Google Drive** secondary actions.
- `/write`: the writing app: toolbar, page sheets, suggestions pane, status bar.
  - `/write?open=drive` opens the "Open from Google Drive" dialog on arrival.
  - `/write?import=local` shows a "Choose a file to import" prompt.
  - `/write?open=picker` shows an "Import from Google Drive" prompt.
  Browsers only open a file chooser or the Google Picker from a click, so the
  last two show a button rather than opening the chooser themselves.
- `/settings`: AI keys and models, suggestion cadence, Google Drive, theme,
  and "Clear all local data". Sections can be deep-linked, e.g. `/settings#ai`
  and `/settings#drive`.

## Adding an AI key

Suggestions need a key from one provider. Without one, the suggestions pane
links you to Settings.

1. Get a key:
   - **Claude:** create one in the [Anthropic Console](https://console.anthropic.com/) (API keys).
   - **OpenAI:** create one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Open **Settings → AI provider**, choose Claude or OpenAI, and paste the key
   into that provider's section. **Test key** makes a free model-lookup call to
   confirm it works.
3. The models default to the cheapest suitable ones: `claude-haiku-4-5` for
   Claude and `gpt-6-luna` for OpenAI. You can type any other model id.
   Known models are priced in `src/features/suggestions/pricing.ts`. The status
   bar keeps a running cost total for the session.

The engine is deliberately quiet:

- It asks only after you pause typing (default 4 s).
- It waits at least a cooldown between automatic requests (default 45 s), and
  the cooldown doubles after errors.
- It keeps at most 2 open suggestions.
- It sends a request only after enough new writing.
- It includes a web-searched trivia attempt at most once per trivia cooldown
  (default 10 minutes; see below). The cooldown is remembered in this browser,
  so reloading, visiting Settings or opening another tab doesn't reset it.

Turn off **Suggest while I write** to get suggestions only when you press
**Generate Suggestions**.

### Current-events trivia (web search)

With **Settings → Suggestions → Current-events trivia (web search)** on (the
default), the AI provider occasionally looks up one recent real-world item that
may be relevant to your manuscript's themes, setting or subjects. The provider
runs the search itself during the request; there is no news API, feed or
server involved.

- **Claude** uses Anthropic's server-side web search tool
  (`web_search_20250305`, `max_uses: 1`). **OpenAI** uses the Responses API
  `web_search` tool with `max_tool_calls: 1` on models that support it (not
  `gpt-4.1-nano`).
- Each trivia attempt normally runs one search. On Claude, if the search takes
  long enough that the API pauses the turn, the app resumes it once, and the
  resumed turn may search again, so the worst case is two searches per
  attempt. Trivia requests are never retried automatically. If OpenAI ever
  rejects `max_tool_calls`, the request is re-sent once without it; the model
  may then search more than once, and every search is counted in the cost.
- Only trivia searches. Grammar, spelling, style, context and general
  suggestions keep their normal cadence and never search. A searched-trivia
  attempt rides along with a normal request at most once per trivia cooldown
  (default 600 s, so at most one every 10 minutes; range 120–86 400 s).
- The trivia card links the pages the provider cited (http/https links only,
  opened in a new tab), each labelled with its site's domain, so a misleading
  page title can't disguise where a link goes. The card always frames the item
  as "Possibly relevant". If the search finds nothing relevant, fails, or cites
  nothing, no trivia card is shown and a normal suggestion fills the slot.
- If web search is disabled for your Claude organization (an admin setting in
  the Claude Console), you'll see a notice once and suggestions carry on
  without search.
- With the toggle off, trivia comes only from the model's training knowledge,
  as before.

**Cost:** Claude charges $10 per 1,000 searches ($0.01 each) plus normal token
cost, and search results count as input tokens. OpenAI's `web_search` tool
costs $10 per 1,000 calls ($0.01 each) on every model, plus search content
tokens at the model's rates. For `gpt-4o-mini` and `gpt-4.1-mini`, OpenAI bills
search content as a fixed 8,000 input tokens per call, which the estimate
adds. (The $25 per 1,000 rate applies only to OpenAI's legacy
`web_search_preview` tool, which this app doesn't use.) The status bar's cost
includes searches, and its tooltip shows how many were made.

## Importing a manuscript you've already started

Bring in a draft from Word, Google Docs, or a text editor. The draft becomes a
new Thunder Writer manuscript that autosaves to this browser and, once Drive is
connected, to your Drive like any other.

**The original file is only read, never changed.** This holds for files on
your computer and for files picked in Google Drive.

- **From your computer:** use **File › Import manuscript…**, drop a file
  anywhere on the writer page, or use **Import a manuscript** on the home page.
  If several files are dropped, only the first is imported (the result says so).
- **From Google Drive:** use **File › Import from Google Drive…**, the
  **Import it straight from Google Drive** link on the home page, or the
  Google Drive button in the import prompt. Google Docs need no download
  first. My Drive and Shared drives each have a tab. This needs the Picker
  setup described below. A Google Drive for desktop `.gdoc` file on your
  computer is only a shortcut; it is refused with a pointer to this route.

| Format | What comes across |
| ------ | ----------------- |
| Word `.docx` | Paragraphs, Title and Heading 1–3 styles (Heading 4–6 become H3), bold, italic, underline, strikethrough, lists, quotes, typed spacing and tabs. Automatic heading numbers (Word's "Chapter 1" heading list numbering) are written into the heading text. The visible Title paragraph names the manuscript, ahead of the file's document properties. Footnotes are kept as a numbered list at the end. Images and comments are left out, and the result dialog says how many. |
| Google Docs | Exported as HTML through the Picker, keeping the same formatting as `.docx`. A Doc too large for Google to export (about 10 MB) must first be downloaded as `.docx` and imported from your computer. |
| `.html` | Headings, paragraphs, marks, lists, quotes and centre/right alignment. Scripts, frames, forms, styles and links are stripped; link text is kept. |
| `.md` | Headings, emphasis, strikethrough, quotes, nested lists, scene breaks, and a `title:` in front matter. A leading `---` counts as front matter only if every line up to the next `---` is YAML; otherwise it is a scene break and nothing is dropped. A `---` under a sentence is a scene break, not a heading. A first `# Title` above the chapters names the manuscript and isn't counted as a chapter. |
| `.txt` | Paragraphs split by blank lines, or one paragraph per line. Lines are joined only when the whole file is hard-wrapped at one width (the dialog says so). A longer gap than usual between paragraphs is kept as an empty line. A short first line above the chapters names the manuscript. |

Text, Markdown and HTML files are read as UTF-8, UTF-16 (with a byte-order
mark) or Windows-1252, and HTML honours its `<meta charset>`. A mostly UTF-8
file with a few stray legacy bytes keeps its UTF-8, and only those bytes are
read as Windows-1252. Files picked in Google Drive are decoded the same way.

Files must be 25 MB or smaller, from your computer or from Drive. A larger
Drive file is stopped during the download. Old `.doc`, password-protected `.docx`, PDF,
RTF, ODT, Pages, EPUB and Scrivener projects are refused, with a message on how
to export them as `.docx` or plain text.

**Chapters and scene breaks.** A standalone line such as "Chapter 1",
"CHAPTER ONE", "Chapter Twelve: The Storm", "Part One", "Prologue" or
"Epilogue" becomes a Chapter heading (H1), so it starts on a new page when
**Chapters start new page** is on. So does "Chapter 4" followed by its title on
the next line (Shift+Enter) in the same paragraph. Bare numerals like "IV" or
"12" are promoted only if at least two appear counting up (I, II, III), so a
"XXX" to-do marker stays text. Paragraphs separated only by `<br><br>` in HTML
are split into separate paragraphs. A sentence that just begins with
"Chapter…" stays a paragraph. Lines such as `* * *`, `***`, `#`, `~~~` or `§`
become the scene-break divider. Your words themselves are never changed; only
empty paragraphs and trailing spaces are tidied.

After the import, a dialog shows the word count, the chapter count, and
anything that was left out. A 120,000-word, 40-chapter `.docx` imports in
about 0.3 s and is fully paginated (389 pages at 6 × 9) in well under a second.

## Google Drive setup (optional)

Drive gives you a cloud copy and lets you open manuscripts on another machine.
You need a Google OAuth **Web** client id, which takes about 3 minutes:

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick
   a project, then enable the **Google Drive API**.
2. Open **Google Auth Platform** (older consoles: **APIs & Services → OAuth
   consent screen**) and fill in **Branding**. External is fine. Add the scope
   `https://www.googleapis.com/auth/drive.file`.
3. Under **Google Auth Platform → Audience → Test users**, add every Google
   account that will connect. While the app is in **Testing**, Google blocks
   any other account with "Access blocked". Publishing the app (**Audience →
   Publish app**) lifts that; `drive.file` is a non-sensitive scope.
4. Under **Google Auth Platform → Clients** (older consoles: **APIs & Services →
   Credentials → Create credentials → OAuth client ID**), create a client of
   type **Web application**.
5. Under **Authorized JavaScript origins**, add `http://localhost:5173` and the
   origin where you host the build. No redirect URI is needed, because the app
   uses Google Identity Services' token popup.
6. Give the client id to the app in either of these ways:
   - Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID=…`, then
     restart `npm run dev`. The value is baked in at build time.
   - Paste it into **Settings → Google Drive → OAuth client ID**. This overrides
     the env value for this browser.

### Importing existing files from Drive (Google Picker)

Opening Google Docs or Word files that Thunder Writer didn't create goes
through Google's file picker. The picker needs a browser API key from the
**same Cloud project** as the OAuth client:

1. In the same project, go to **APIs & Services → Library** and enable the
   **Google Picker API**. The Google Drive API must stay enabled too.
2. Go to **APIs & Services → Credentials → Create credentials → API key**.
3. Edit the key and restrict it:
   - **Application restrictions → Websites:** add `http://localhost:5173/*`,
     your hosted origin (e.g. `https://writer.example.com/*`), and
     `https://docs.google.com/*`. The picker runs in a frame on
     docs.google.com, and Google rejects the key with "The API developer key
     is invalid" without that entry.
   - **API restrictions:** restrict the key to the **Google Picker API** only.
4. Give the key to the app in one of two ways:
   - Set `VITE_GOOGLE_API_KEY=…` in `.env.local` and restart.
   - Paste the key into **Settings → Google Drive → Google API key**.
5. The picker also needs the project **number** as its app id. Thunder Writer
   reads it from the start of the client id (`698829428298-….apps.googleusercontent.com`
   → `698829428298`), and **Settings → Google Drive** lets you override it. It
   must match the project that owns the client id, or picked files can't be
   read.

This API key identifies the app to Google but doesn't unlock anyone's files.
Access to files still needs the writer's own OAuth consent, so the key isn't a
secret in the way AI keys are. Even so, it is kept out of the Drive settings
sync, together with the project number override.

**Why a picker instead of broad Drive access?** Listing or reading arbitrary
Drive files would need the `drive.readonly` or `drive` scope. Google treats
both as *restricted* scopes, which require an annual third-party security
assessment before the app can be offered to other people. With `drive.file`
and the Picker, the writer chooses exactly which file Thunder Writer may open,
and the app can't see anything else in their Drive.

Scope and behaviour:

- The app asks only for `drive.file`. That gives access only to two kinds of
  file: those Thunder Writer created, and those you pick in the Google Picker
  to import. The app can't see anything else in your Drive.
- An imported file is read once and never written to. The manuscript made from
  it is saved as a new `.thunder.json` file in the **Thunder Writer** folder.
- Manuscripts are saved as `<title>.thunder.json` in a **Thunder Writer**
  folder. Non-secret preferences (including the trivia toggle and cooldown)
  can be synced as `thunder-writer.config.json`.
  API keys, the client id, the Google API key and the project number are
  never uploaded.
- The access token is kept in memory only. After a reload, press **Connect** in
  the File menu again.
- Autosave to Drive runs about 5 s after you pause, and at most once per
  interval (default 60 s) while there are unsaved changes. Local browser saves
  happen about half a second after every change.

## Privacy model

- **No server.** Nothing about your writing is sent to Thunder Writer, because
  there is nothing to send it to.
- **Manuscripts:** stored in IndexedDB (`thunder-writer` database) in this
  browser, and in your Google Drive if you connect it. Reference ("context")
  files are stored in the `thunder-writer-context` database.
- **Keys:** your Claude/OpenAI keys are stored in this browser's
  `localStorage` (`thunder-writer:settings`) and sent only to their own
  provider. The trivia cooldown keeps only a timestamp in `localStorage`, and a
  "web search unavailable" note for this tab stores the provider, model and a
  short non-reversible fingerprint of the key, never the key itself.
- **AI requests:** these go directly from the browser to `api.anthropic.com`
  or `api.openai.com`. They contain the manuscript (or, for long books, the
  opening plus the region around your cursor), your context files (capped), and
  recent suggestion titles.
- **Web-searched trivia:** when it's on, the provider may send short search
  queries derived from your manuscript to its search backend (Anthropic's or
  OpenAI's search provider). The prompt asks the model to search by topic or
  place, not your sentences or character names, but it writes the query itself.
  Turn the toggle off to prevent this.
- **Tradeoff:** a key in `localStorage` can be read by any script running on
  the page's origin, such as a malicious browser extension or an XSS bug. That
  is the price of having no backend to hide it behind. To limit the risk:
  - Use a dedicated key with a low spending limit.
  - Don't use Thunder Writer on shared machines.
  - Revoke the key if in doubt.
  - Use **Settings → Clear all local data** to wipe everything this app stored
    in the browser. Your Drive files are not touched.

## Architecture

React 19 + TypeScript + Vite, with TipTap 3 (ProseMirror) for the editor,
zustand for state, zod for validating anything loaded from storage or the
network, and idb-keyval for IndexedDB.

```
src/
  main.tsx, App.tsx        Router + routes; StorageProvider wraps everything
  types.ts                 Shared domain types (ThunderDoc, DocFormat, Suggestion, …)
  contracts.ts             EditorBridge: how the suggestions pane talks to the editor
  store/
    settings.ts            Persisted settings (localStorage), default models
    documents.ts           In-memory documents; storage hydrates and subscribes
    session.ts             Suggestions, accepted count, AI usage/cost for this session
  shell/                   EditorContext, theme hook, ThemeToggle
  styles/theme.css         Design tokens (light/dark) and base button styles
  features/
    home/                  Landing page + animated demo (demoScript.ts is a pure timeline)
    editor/                /write layout (WriterPage), Toolbar, StatusBar,
                           book presets, pagination (pure page-break math) and
                           PageView, bridge.ts/textIndex.ts (quote find/highlight/replace)
    suggestions/           SuggestionsPane + cards, scheduling/cooldown (scheduler.ts),
                           prompt building, response sanitising, pricing,
                           trivia.ts (parsing web-searched trivia + sources),
                           providers/ (Claude + OpenAI browser clients), context files
    storage/               IndexedDB persistence, Google auth (GIS token model),
                           Drive client, Drive autosave scheduler, FileMenu and dialogs,
                           Google Picker loader and Drive import (picker.ts, driveImport.ts)
    import/                importManuscript(): .docx (mammoth, lazy-loaded), HTML/Google
                           Docs, Markdown and text → TipTap JSON; chapter/scene-break
                           detection; ImportHost (progress/result dialogs), drag-and-drop
    settings/              SettingsPage, key testing, "Clear all local data"
```

Data flow:

1. `StorageProvider` loads documents from IndexedDB into `useDocuments` and
   writes changes back.
2. `WriterPage` opens the current document in TipTap and debounces edits into
   the store (400 ms).
3. The suggestions engine reads text through the `EditorBridge`, calls the
   provider, and keeps only suggestions whose quoted passage is actually in the
   document.
4. Accept replaces that passage as one undoable edit.

Web-searched trivia is a separate, small request made alongside a normal one:
it has the search tool on and no structured-output schema (web search always
returns citations, and citations with `output_config.format` are not documented
as compatible), so the model replies with one JSON object or `NONE`, which is
parsed leniently and validated with the same zod schema and sanitiser.

Tests are colocated as `*.test.ts(x)` and run in jsdom. The pagination,
scheduler, prompt, pricing, Drive and autosave logic are covered as pure units.

## Saving to your computer

Code: `src/features/export/` (mounted by `WriterPage` via `<ExportHost />`).

- **Save to computer ▾** (writer header, next to **File**; also **File › Save to
  computer…**) saves a one-off copy of the open manuscript as Word `.docx`
  (recommended: book trim size, margins, font, chapters as Heading 1 starting
  new pages, page numbers), Markdown, plain text, a print-ready `.html` page
  (Print → Save as PDF gives a book-sized PDF) or a `.thunder.json` backup.
  The `docx` library is loaded lazily, only when a Word file is built.
- In Chrome and Edge the native Save dialog (`showSaveFilePicker`) opens on the
  Desktop. Elsewhere, or if the dialog is blocked, the file is downloaded
  through a temporary link and lands in Downloads (turn on "Ask where to save
  each file" in the browser to pick the Desktop).
- **Keep a copy on my computer** (Chrome/Edge, File System Access API): choose
  a file once; it is rewritten about 15 s after you pause (at least every 30 s
  while typing), when the tab is hidden, when you switch to another manuscript,
  and on Cmd/Ctrl+S. The file handle is kept per manuscript in IndexedDB
  (`thunder-writer-export`). After a reload the browser asks for write
  permission again: click **Resume copy** in the header or press Cmd/Ctrl+S.
  Deleting a manuscript stops its copy and forgets the handle (the file on
  disk is left alone); **Clear all local data** removes the handles too.
- **Cmd/Ctrl+S** is caught everywhere on `/write`, including inside the editor,
  so the browser's "Save page" dialog never opens. It pushes the editor's
  debounced keystrokes into the store, writes IndexedDB immediately and waits
  for it before saying "Saved in your browser", then writes the desktop copy
  if there is one (or opens **Save to your computer** the first time).
  Cmd/Ctrl+**Shift**+S is left to the editor (strikethrough).
- Round trips are tested (`src/features/export/roundtrip.test.ts`): a saved
  `.docx`, `.md` or `.txt` re-imported with **File › Import manuscript…** comes
  back with the same words, chapters, sections and scene breaks, and (Word and
  Markdown) the same bold, italic, underline, strikethrough, highlight, lists
  and block quotes. The importer reads Word's Quote style as a block quote and
  its highlighter as highlight, and Markdown's `<u>…</u>` and `==…==`.
