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

- `/`: home page with an animated demo and the **Start Writing** call to action.
- `/write`: the writing app: toolbar, page sheets, suggestions pane, status bar.
  `/write?open=drive` opens the Google Drive file picker on arrival.
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

## Google Drive setup (optional)

Drive gives you a cloud copy and lets you open manuscripts on another machine.
You need a Google OAuth **Web** client id, which takes about 3 minutes:

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick
   a project, then enable the **Google Drive API**.
2. Set up the **OAuth consent screen**. External is fine, and add yourself as a
   test user while it is in testing. Add the scope
   `https://www.googleapis.com/auth/drive.file`.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**
   and choose **Web application**.
4. Under **Authorized JavaScript origins**, add `http://localhost:5173` and the
   origin where you host the build. No redirect URI is needed, because the app
   uses Google Identity Services' token popup.
5. Give the client id to the app in either of these ways:
   - Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID=…`, then
     restart `npm run dev`. The value is baked in at build time.
   - Paste it into **Settings → Google Drive → OAuth client ID**. This overrides
     the env value for this browser.

Scope and behaviour:

- The app asks only for `drive.file`, which gives access to files Thunder
  Writer itself created and nothing else in your Drive.
- Manuscripts are saved as `<title>.thunder.json` in a **Thunder Writer**
  folder. Non-secret preferences (including the trivia toggle and cooldown)
  can be synced as `thunder-writer.config.json`.
  API keys and the client id are never uploaded.
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
                           Drive client, Drive autosave scheduler, FileMenu and dialogs
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
