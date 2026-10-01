# Thunder Writer: technical notes

For developers and maintainers. The product overview is in
[README.md](README.md).

Thunder Writer is a static, browser-only React app. There is **no backend**.
Manuscripts live in IndexedDB and, optionally, the writer's own Google Drive.
AI calls go straight from the browser to Anthropic or OpenAI with the writer's
own key. The owner's original design (UI boxes and behaviour notes) is in
[ThunderWriter.drawio](ThunderWriter.drawio).

## Contents

- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Routes](#routes)
- [AI providers, models and cost](#ai-providers-models-and-cost)
- [Google Cloud setup](#google-cloud-setup)
- [Backups](#backups)
- [Support the developer](#support-the-developer)
- [Suggestions](#suggestions)
- [Deploying to Vercel](#deploying-to-vercel)
- [Privacy and security model](#privacy-and-security-model)
- [Architecture](#architecture)
- [Import pipeline](#import-pipeline)
- [Focus Mode and typewriter sounds](#focus-mode-and-typewriter-sounds)
- [Saving to the computer (export, PDF and desktop copy)](#saving-to-the-computer-export-pdf-and-desktop-copy)
- [Book Preview and pagination](#book-preview-and-pagination)
- [Performance](#performance)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Not yet verified against live services](#not-yet-verified-against-live-services)

## Getting started

Requires Node 22.12+ (Node 24 recommended). Vitest 5 needs 22.12 or newer, and
Vite 8 needs 20.19+ or 22.12+; `package.json` declares `"engines": { "node": ">=22.12" }`
and `.nvmrc` pins 24.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Vite dev server on http://localhost:5173       |
| `npm run build`     | Type-check (`tsc -b`) and build to `dist/`     |
| `npm run preview`   | Serve the production build locally             |
| `npm test`          | Run the Vitest suite once                      |
| `npm run typecheck` | Type-check only (`tsc -b --noEmit`)            |

`dist/` is a static site. Host it anywhere that serves files, with SPA
fallback to `index.html` so `/write` and `/settings` resolve (see
[Deploying to Vercel](#deploying-to-vercel)).

The app works without any configuration: writing, import, Book Preview and
saving to the computer need nothing. AI suggestions need a key (entered at
runtime in Settings). Google Drive is switched on by the deployment, not the
writer: build with your project's `VITE_GOOGLE_*` values
([Google Cloud setup](#google-cloud-setup)) and every writer can connect their
own Drive with nothing to enter. Without them the build simply leaves Drive out.

Stack: React 19, TypeScript, Vite 8, TipTap 3 (ProseMirror) for the editor,
zustand for state, zod for validating anything loaded from storage or the
network, idb-keyval for IndexedDB, mammoth (lazy) for `.docx` import, docx
(lazy) for `.docx` export, and the official `@anthropic-ai/sdk` and `openai`
SDKs. `vite.config.ts` pre-bundles `docx` and `mammoth` so the dev server
doesn't discover them mid-session and reload the page (losing that save or
import).

## Environment variables

Copy `.env.example` to `.env.local` (git-ignored) and fill in what you need.
The values are baked into the bundle at build time (`import.meta.env`, read in
`src/features/storage/googleConfig.ts`). They identify **your** Google Cloud
project, the one every writer's Drive connection goes through, so they are the
deployment's to set: the app has no fields for them, and a writer only ever sees
Google's own consent popup.

| Variable | Used for | Required? |
| --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | OAuth 2.0 **Web** client id for Google Drive (Google Identity Services token model). | For Drive. Blank = the build has no Drive: its menu items, dialogs, the Home page's Drive fallback and the Settings section are left out. |
| `VITE_GOOGLE_API_KEY` | Browser API key for the Google Picker ("Import from Google Drive…"). | For importing existing Drive files. Blank = no import from Drive. |
| `VITE_GOOGLE_PROJECT_NUMBER` | The Picker's app id. | No. Defaults to the number at the start of the client id, which is almost always right. |
| `VITE_SUGGESTION_ENDPOINT` | Where the Suggestion form posts. | No. Defaults to FormSubmit, forwarding to marc@mickerstudios.com. |
| `VITE_BOOKSHOP_AFFILIATE_ID` | Your Bookshop.org affiliate id (digits): makes the **Support the developer** book picks affiliate links (`src/features/support/bookPicks.ts`). | No. Without it the picks are plain Bookshop.org links. |

Restart `npm run dev` after editing `.env.local`, and redeploy after changing
them on the host. Settings saved by versions before settings v4 could hold a
client id, API key or project number entered in the browser; the v4 migration
removes them (`RETIRED_GOOGLE_KEYS` in `src/store/settings.ts`). There are no
AI key variables on purpose: AI keys belong to the writer, not the deployment,
and are entered in Settings.

## Routes

- `/`: home page with an animated demo (`demoScript.ts` is a pure timeline)
  and two calls to action (`HeroActions.tsx`):
  - **Start Writing** goes to `/write?new=1`, a fresh manuscript.
  - **Continue Writing** reopens the manuscript last open in this browser
    (from IndexedDB; a blank "Untitled Manuscript" nobody wrote in doesn't
    count), and names it underneath. When this browser has none (a new
    computer, cleared data), the button connects Google Drive straight from
    the click, so the consent popup isn't blocked, then goes to
    `/write?open=drive` to list the manuscripts saved there. In a build without
    Drive it is left out.
  Below them, text links to **Import a manuscript** and, when the Picker key is
  set, **import it from Google Drive**.
- `/write`: the writing app: toolbar, page sheets, suggestions pane, status bar.
  - `/write?new=1` opens a fresh manuscript (once per navigation, replacing a
    blank one left from an earlier visit), then drops the parameter.
  - `/write?open=drive` opens the "Open from Google Drive" dialog on arrival.
  - `/write?import=local` shows a "Choose a file to import" prompt.
  - `/write?open=picker` shows an "Import from Google Drive" prompt.
  Browsers only open a file chooser or the Google Picker from a click, so the
  last two show a button rather than opening the chooser themselves.
- `/settings`: AI keys and models, suggestion cadence, Google Drive (only the
  Drive autosave interval, and only in builds with Drive; nothing to set up),
  theme, and "Clear all local data". Sections can be deep-linked: `#ai`, `#claude`,
  `#openai`, `#suggestions`, `#drive`, `#appearance`, `#data`.

## AI providers, models and cost

### Keys

Suggestions need a key from one provider. Without one, the suggestions pane
links to Settings.

1. Get a key:
   - **Claude:** create one in the [Anthropic Console](https://console.anthropic.com/) (API keys).
   - **OpenAI:** create one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Open **Settings → AI provider**, choose Claude or OpenAI, and paste the key
   into that provider's section. **Test key** makes a free model-lookup call to
   confirm it works.
3. The models default to the cheapest suitable ones: `claude-haiku-4-5` for
   Claude and `gpt-6-luna` for OpenAI (`DEFAULT_CLAUDE_MODEL` /
   `DEFAULT_OPENAI_MODEL` in `src/store/settings.ts`). Any other model id can
   be typed in.

Both SDKs are constructed with `dangerouslyAllowBrowser: true` (see
[Privacy and security model](#privacy-and-security-model)), a 60 s request
timeout, and at most 2 suggestions per request (`MAX_PER_REQUEST`). Claude
regular requests use structured output (`output_config.format` with a JSON
schema); OpenAI uses the Responses API. OpenAI reasoning families (GPT-5.x,
GPT-6.x, o-series) are sent with `reasoning.effort: 'low'`, because reasoning
tokens bill as output.

### Cadence (the "not too chatty" rules)

The engine (`src/features/suggestions/scheduler.ts`, `constants.ts`) is
deliberately quiet:

- It asks only after the writer pauses typing (default 4 s, range 1–120 s).
- It waits at least a cooldown between automatic requests (default 45 s,
  range 5–3600 s), and the cooldown doubles after consecutive errors, up to 8×.
- It keeps at most 2 open suggestions (range 1–5).
- It sends a request only after at least 40 new characters, and only once the
  manuscript has 40 characters.
- Manual **Generate Suggestions** has a 5 s minimum gap.
- It includes a web-searched trivia attempt at most once per trivia cooldown
  (below). The cooldown is remembered in this browser (`triviaMemory.ts`), so
  reloading, visiting Settings or opening another tab doesn't reset it.

All numeric bounds live in `SETTING_BOUNDS` and are applied to the Settings UI,
to config loaded from Drive, and inside the engine, so no path can bypass the
floors. Turning off **Suggest while I write** leaves only the manual button.

### What goes into a prompt

- The whole manuscript when it is at most 16,000 characters; otherwise the
  first 4,000 characters (voice, setup, characters) plus 8,000 characters
  around the cursor.
- A 1,500-character "focus" excerpt around the cursor.
- Reference ("context") files: at most 24,000 characters in total and 12,000
  per file. Uploads are limited to 12 files, 2 MB each, 400,000 characters in
  total, and `.txt`, `.md`, `.markdown`, `.html`, `.htm`, `.json` or `.rtf`.
- Up to 30 previously shown suggestion titles (120 characters each) so the
  model doesn't repeat itself.

The system prompt contains nothing that changes between requests. On Claude the
stable prefix (the system prompt, or the reference-file block when there is
one) is marked `cache_control: ephemeral`. A prefix shorter than the model's
minimum cacheable length is simply not cached.

The engine keeps only suggestions whose quoted passage is actually in the
document. Model output is capped (title 140, detail 1,500, quote 400
characters) and rendered as plain text.

### Current-events trivia (web search)

With **Settings → Suggestions → Current-events trivia (web search)** on (the
default), the provider occasionally looks up one recent real-world item that
may be relevant to the manuscript's themes, setting or subjects. The provider
runs the search itself during the request. There is no news API, feed or
server involved.

- **Claude** uses Anthropic's server-side web search tool
  (`web_search_20250305`, `max_uses: 1`). **OpenAI** uses the Responses API
  `web_search` tool with `max_tool_calls: 1` on models that support it (not
  `gpt-4.1-nano`).
- Each trivia attempt normally runs one search. On Claude, if the search takes
  long enough that the API pauses the turn (`pause_turn`), the app resumes it
  once, and the resumed turn may search again, so the worst case is two
  searches per attempt. Trivia requests are never retried automatically. If
  OpenAI ever rejects `max_tool_calls`, the request is re-sent once without it;
  the model may then search more than once, and every search is counted in the
  cost.
- Only trivia searches. Grammar, spelling, style, context and general
  suggestions keep their normal cadence and never search. A searched-trivia
  attempt rides along with a normal request at most once per trivia cooldown
  (default 600 s, so at most one every 10 minutes; range 120–86,400 s).
- The trivia request is separate and small: it has the search tool on and no
  structured-output schema (web search always returns citations, and
  citations with `output_config.format` are not documented as compatible). The
  model replies with one JSON object or `NONE`, which is parsed leniently
  (`trivia.ts`) and validated with the same zod schema and sanitiser.
- The trivia card links the pages the provider cited (http/https only, at most
  3, opened in a new tab), each labelled with its site's domain, so a
  misleading page title can't disguise where a link goes. The card always
  frames the item as "Possibly relevant". If the search finds nothing
  relevant, fails, or cites nothing, no trivia card is shown and a normal
  suggestion fills the slot.
- If web search is disabled for the Claude organization (an admin setting in
  the Claude Console), the writer sees a notice once and suggestions carry on
  without search.
- With the toggle off, trivia comes only from the model's training knowledge.

### Pricing table

Known models are priced in `src/features/suggestions/pricing.ts` (USD per
million tokens, rates cached 2026-09). A few of them:

| Model | Input | Output | Notes |
| --- | --- | --- | --- |
| `claude-haiku-4-5` (default) | $1 | $5 | Cache writes 1.25× input, cache reads 0.1× input. |
| `claude-sonnet-4-6` | $3 | $15 | |
| `gpt-6-luna` (default) | $0.10 | $0.50 | Cached input $0.01. |
| `gpt-4o-mini` | $0.15 | $0.60 | Cached input $0.075. |

Web search:

- **Claude:** $10 per 1,000 searches ($0.01 each) plus normal token cost.
  Search results count as input tokens. Failed searches are not billed.
- **OpenAI** `web_search`: $10 per 1,000 calls ($0.01 each) on every model,
  plus search content tokens at the model's rates. For `gpt-4o-mini` and
  `gpt-4.1-mini`, OpenAI bills search content as a fixed 8,000 input tokens per
  call, which the estimate adds. (The $25 per 1,000 rate applies only to the
  legacy `web_search_preview` tool, which this app doesn't use.)

The status bar's **AI cost** includes searches, and its tooltip shows tokens
and how many searches were made. For a model not in the table, the engine adds
$0 and the pane footer says "cost unknown for <model>".

### What a session costs

These are **estimates from the code's limits and the published rates above**,
using about 4 characters per token for English prose. They have not been
checked against a real bill.

One regular suggestion request to **Claude Haiku 4.5**:

| Part | Size | Cost |
| --- | --- | --- |
| System prompt | ~2,300 characters ≈ 600 tokens | ≈ $0.0006 |
| Manuscript view + focus | ≤ 17,500 characters ≈ 4,400 tokens | ≤ $0.0044 |
| Already-shown list | ≤ 3,600 characters ≈ 900 tokens | ≤ $0.0009 |
| Output (≤ 2 suggestions of JSON) | ~200–500 tokens | ≈ $0.001–0.0025 |
| **Total without reference files** | | **≈ $0.005–0.008** |
| Reference files (≤ 24,000 characters ≈ 6,000 tokens) | first request writes the cache at 1.25× | + ≈ $0.0075 once |
| | later requests read the cache at 0.1× (the 45 s cadence keeps a 5-minute cache warm) | + ≈ $0.0006 each |

So a request costs about a cent or less. The automatic cadence allows at most
one request per 45 s, i.e. at most 80 an hour, which puts a hard ceiling of
roughly **$0.50–0.70 per hour of non-stop drafting** on regular requests. Real
sessions have fewer requests, because each needs a pause and 40 new
characters.

Web-searched trivia adds at most 6 attempts an hour at the default cooldown.
Each is $0.01 per search (two in the worst case) plus the search results as
input tokens, so roughly $0.02–0.04 per attempt and at most about $0.25 an
hour.

On **GPT-6 Luna** the token part is about a tenth of the Haiku figures; web
search is the same $0.01 per call.

To spend less: raise the cooldown, lower the maximum open suggestions, turn
off web-searched trivia, or turn off **Suggest while I write**.

## Google Cloud setup

Drive gives the writer a cloud copy and lets them open manuscripts on another
machine. Importing Google Docs and other existing Drive files additionally
uses the Google Picker. Everything below is done **once, by whoever deploys
the app**, in **one** Google Cloud project; the resulting values go into the
build as env vars. Writers never see any of it, only Google's consent popup
naming your app.

### 1. Project and APIs

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick
   a project.
2. Under **APIs & Services → Library**, enable the **Google Drive API** and the
   **Google Picker API**.

### 2. OAuth consent screen and audience

1. Open **Google Auth Platform** (older consoles: **APIs & Services → OAuth
   consent screen**) and fill in **Branding**. User type **External** is fine.
2. Add the scope `https://www.googleapis.com/auth/drive.file`. It is the only
   scope the app requests.
3. **Audience.** While the app's publishing status is **Testing**, only the
   accounts listed under **Google Auth Platform → Audience → Test users** can
   connect. Add every Google account that will use it. Any other account gets
   "Access blocked" / `Error 403: access_denied`.
4. To open it to everyone, choose **Audience → Publish app**. `drive.file` is
   a non-sensitive scope, so publishing doesn't need Google's restricted-scope
   security assessment. (Google may still ask to verify branding details such
   as the app name and domain.)

**Why `drive.file` and a picker instead of broad Drive access?** Listing or
reading arbitrary Drive files would need the `drive.readonly` or `drive`
scope. Google treats both as *restricted* scopes, which require an annual
third-party security assessment before the app can be offered to other people.
With `drive.file` and the Picker, the writer chooses exactly which file
Thunder Writer may open, and the app can't see anything else in their Drive.

### 3. OAuth client

1. Under **Google Auth Platform → Clients** (older consoles: **APIs & Services
   → Credentials → Create credentials → OAuth client ID**), create a client of
   type **Web application**.
2. Under **Authorized JavaScript origins**, add every origin the app is served
   from, with no path and no trailing slash:
   - `http://localhost:5173` (dev server),
   - `http://localhost:4173` if you use `npm run preview`,
   - the production origin, e.g. `https://<your-project>.vercel.app`, and any
     custom domain.
   No redirect URI is needed, because the app uses Google Identity Services'
   token popup.
3. Give the client id to the build as `VITE_GOOGLE_CLIENT_ID`: in
   `.env.local` for development (restart the dev server), and on the host for
   deployments ([Deploying to Vercel](#deploying-to-vercel)).

### 4. API key for the Picker

The Picker needs a browser API key from the **same project** as the OAuth
client.

1. **APIs & Services → Credentials → Create credentials → API key.**
2. Edit the key and restrict it:
   - **Application restrictions → Websites:** add `http://localhost:5173/*`,
     `http://localhost:4173/*` if you use `npm run preview`, the hosted origin
     (e.g. `https://<your-project>.vercel.app/*`), and
     `https://docs.google.com/*`. The Picker runs in a frame on
     docs.google.com, and Google rejects the key with "The API developer key is
     invalid" without that entry.
   - **API restrictions:** restrict the key to the **Google Picker API** only.
3. Give the key to the build as `VITE_GOOGLE_API_KEY`, the same way.
4. The Picker also needs the project **number** as its app id. Thunder Writer
   reads it from the start of the client id
   (`698829428298-….apps.googleusercontent.com` → `698829428298`);
   `VITE_GOOGLE_PROJECT_NUMBER` overrides it. It must match the project that
   owns the client id, or picked files can't be read.

This API key identifies the app to Google but doesn't unlock anyone's files.
Access to files still needs the writer's own OAuth consent, so the key isn't a
secret in the way AI keys are. It is part of the build, not a setting, so it is
never stored in the browser or synced to Drive.

### Common errors

| Error | Cause | Fix |
| --- | --- | --- |
| `Error 400: origin_mismatch` (or `redirect_uri_mismatch`) in the Google popup | The page's origin isn't in the client's **Authorized JavaScript origins**. | Add the exact origin (scheme, host, port), then wait a few minutes for it to take effect. |
| `Error 403: access_denied` / "Access blocked" | The app is in **Testing** and the account isn't a test user, or the writer declined consent. | Add the account under **Audience → Test users**, or publish the app. |
| The Picker says it "couldn't open" (the console logs a `VITE_GOOGLE_API_KEY` hint), or "The API developer key is invalid" | The key's website restrictions lack `https://docs.google.com/*` or the current origin, or the Picker API isn't enabled or allowed for the key. | Fix the key's restrictions, and enable the Picker API. |
| Picked file can't be read | The project number (app id) doesn't match the client id's project. | Remove or correct `VITE_GOOGLE_PROJECT_NUMBER` and rebuild. |
| Popup blocked / "The Google window did not finish" | The sign-in popup must come from a click. | Click **Connect** (File menu), or **Continue Writing** on the Home page, again. |

### Drive behaviour

- The app asks only for `drive.file`. That gives access to two kinds of file:
  those Thunder Writer created, and those picked in the Google Picker to
  import. The app can't see anything else in the Drive.
- Manuscripts are saved as `<title>.thunder.json` in a **Thunder Writer**
  folder, and that is all Drive is used for: settings stay in the browser
  (earlier versions could sync preferences as `thunder-writer.config.json`; the
  app no longer reads or writes it). AI keys are never uploaded, and the Google
  values aren't settings at all (they are part of the build).
- An imported file is read once and never written to. The manuscript made from
  it is saved as a new `.thunder.json` file in the **Thunder Writer** folder.
- The access token is kept in memory only. After a reload, press **Connect** in
  the File menu again (or, in a browser with no manuscripts yet, **Continue
  Writing** on the Home page, which connects and lists the Drive manuscripts). Tokens last about an hour; if the browser blocks the
  renewal popup during autosave, the status shows "Drive error — retry", and
  clicking it renews the token.
- Autosave to Drive runs about 5 s after a pause, and at most once per
  interval (default 60 s, `driveAutosaveSec`; 0 means only on the pause) while
  there are unsaved changes. It is single-flight and backs off after a failure
  (`src/features/storage/autosave.ts`).
- If autosave finds the Drive file changed elsewhere, it fetches Drive's
  version and asks the writer which to keep (`ResolveConflictModal.tsx`).
  Both versions are always kept somewhere: see [Backups](#backups).
- **Open from Drive** lists the manuscripts in every **Thunder Writer** folder
  the app created (two tabs connecting for the first time at once can each
  make one; new saves go to the oldest). It lists only those folders, so a
  `.thunder.json` picked elsewhere to import (maybe a co-author's) is never
  listed, linked and then autosaved into.
- Nothing is uploaded when the page closes, because the browser can't reliably
  finish an upload then. Local saving is always flushed, and Drive catches up
  on the next connect.
- A manuscript imported from a Google Doc is a copy. Nothing is ever written to
  the Google Doc, and later edits made in Google Docs don't come in.

## Backups

Two layers, so a version is never lost to an overwrite
(`src/features/backups/`, and `backupDocFile` in `src/features/storage/drive.ts`).

**In this browser (IndexedDB, database `thunder-writer-backups`).** Each
backup is a `meta:<id>` record (listed in the menu) and a `data:<id>` record
(the whole manuscript, read only when opened). The manuscripts database isn't
touched, so startup never reads backups.

- *Automatic:* the first edit to a manuscript in each session backs up the
  version from before it; after that, at most one every 10 minutes while
  editing (`createAutoBackup`, driven from `StorageProvider`). A backup that
  would hold the same version as the latest is skipped.
- *Safety copies*, taken just before something replaces or removes a
  manuscript: opening the Drive version over this browser's, importing a file
  over it, deleting it (Open manuscript › delete), and the Drive version that
  "Keep this browser's version" overwrites. `safetyBackup` gives up after 4 s
  and reports whether the copy was kept. Delete and import-over ask a second
  time, with "This cannot be undone", when it wasn't. Opening the Drive
  version goes ahead either way: the version it replaces is in the conflict
  dialog's other choices and in Drive.
- *Retention* (`backupsToPrune`), per manuscript: the 10 newest; then, for
  each of the last 30 days, the backup holding that day's latest text (by the
  text's own time, `docUpdatedAt`, since an automatic backup holds the version
  from before an edit and so saves the evening's text the next morning); and
  backups the writer made (**Back up now**) and safety copies for 90 days (up
  to 30).
- *Failures:* a backup that couldn't be saved (storage full) shows a line in
  the menu and dialog until one succeeds. Automatic backups retry at the usual
  interval, not on every keystroke. One stuck write doesn't hold up later ones
  for more than 15 s.
- *Where:* the **Backups ▾** menu in the writer header lists the open
  manuscript's backups (words, time, why it was kept) with **Back up now**.
  **All backups…** lists every manuscript's, including deleted ones, with
  **Open copy** and **Download** (a `.thunder.json`, or an original file
  exactly as it was on the computer). Opening a backup always
  makes a new manuscript, "<title> (backup <when>)"; nothing is overwritten.
  The copy isn't uploaded to Drive until it's edited (`isUntouchedCopy`, which
  Drive autosave skips), and the confirmation offers **Undo**, which closes it
  and goes back while it's untouched. **File › Open from computer…** on a
  downloaded backup or `.bak` replaces this browser's copy of that same
  manuscript, after asking and after a safety backup.
- *Original files:* before Thunder Writer first saves over a file on the
  computer (File › Open from computer › Keep saving to it), and whenever that
  file turns out to have changed elsewhere, the file itself is kept byte for
  byte (`'original-file'`).
- **Clear all local data** removes them with everything else.

**In Google Drive (`<title>.thunder.json.bak`).** Before Thunder Writer writes
over a manuscript's Drive file for the first time in a session, and always
before "Keep this browser's version", Drive's current copy is saved as a
`.bak` in the (oldest) **Thunder Writer** folder. It always goes there, even
if the writer moved the manuscript: `drive.file` can't add files to a folder
the app didn't create. There is one per manuscript, found again through
its `appProperties.thunderBackupOf` (the manuscript's file id), so a renamed
manuscript doesn't leave an old one behind. If the `.bak` can't be written,
the save fails and autosave retries: nothing is overwritten without it.
"Open from Drive" doesn't list `.bak` files. **File › Import from Google
Drive… › Thunder Writer saves** imports one as a new manuscript. **File ›
Open from computer…** replaces this browser's copy, as above. Drive's own version history (kept for about 30
days for files like these) is a third layer.

## App icon and brand assets

The logo is the husky with the lightning bolt. All files were cut from one
brand sheet (rounded/circle masks with transparent corners) and generated at
the sizes browsers ask for:

| File | Use |
|---|---|
| `public/favicon.ico` (16/32/48), `public/favicon-32.png` | Browser tab |
| `public/apple-touch-icon.png` (180, full-bleed) | iOS home screen (iOS rounds it) |
| `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png` | `public/manifest.webmanifest` (Add to Home Screen / install) |
| `src/assets/brand/logo-{64,128,192}.png` | In-app logo, `src/shell/AppLogo.tsx` (header of Home, Writer, Settings; Home closing call to action) |
| `public/brand/thunder-writer-*.png` | Full set at source resolution: icon, circle, light-mode, husky only, bolt only, bolt circle, monochrome light/dark |

The source art is about 560 px, so nothing larger than 512 px is generated.
The small bolt inside the Home page's demo window is still the vector
`BoltMark` (the full icon is too detailed at 14 px).

## Support the developer

`src/features/support/`. On by default (`supportDeveloper` in settings, saved
in the browser; browsers that already saved settings keep their stored
choice). Off, the toolbar shows **♥ Support the developer** just left
of **Preview Book**. On, that spot shows one book pick a day, marked "Ad", as
a plain link to Bookshop.org (an affiliate link with
`VITE_BOOKSHOP_AFFILIATE_ID`), opening in a new tab with `rel="sponsored"`.
There are no ad scripts, cookies or tracking, so the privacy promises hold:
nothing happens unless the writer clicks. Its ✕ asks **Please reconsider**
(**Keep supporting** is the default) before turning it off. The picks are a
short list in `bookPicks.ts`; edit them freely.

**Tip jar.** `src/features/support/tipJar.tsx`. A plain link to the
developer's Venmo profile (`https://venmo.com/u/MarcAMartin`;
`VITE_VENMO_HANDLE` overrides the handle at build time). It appears as
**☕ Tip jar** beside the book pick / Support Developer button, as an
alternative in the **Please reconsider** dialog, and as **Tip the developer**
in the Home page footer. Like the book picks it is only a link: no scripts,
cookies or tracking, and payment happens entirely on Venmo (US accounts).

## Suggestions

`src/features/feedback/`. **Suggestion** (writer top bar, beside Settings)
opens a short form: the suggestion and an optional email for a reply. There
is no server, so it posts JSON to FormSubmit's AJAX endpoint
(`https://formsubmit.co/ajax/marc@mickerstudios.com`), which emails it on,
with Reply-To set from the email field. **The first submission makes
FormSubmit send an activation email to that address; nothing is delivered
until it is confirmed.** `VITE_SUGGESTION_ENDPOINT` points the form elsewhere.
If sending fails, the form offers a `mailto:` link with everything filled in.
A hidden honeypot field drops what bots that fill in the page itself enter; it doesn't stop scripts that post to FormSubmit directly (FormSubmit's own filtering does that). The form says that only what
is typed is sent, never the manuscript.

## Deploying to Vercel

The repo is set up for Vercel as a static site. `vercel.json`:

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/((?!assets/|brand/|favicon|apple-touch-icon|icon-|manifest\\.webmanifest).*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

The rewrite is the SPA fallback: every path except built assets and the
icon files in `public/` (favicons, home-screen icons, the web app manifest and
`brand/`) is served `index.html`, so deep links like `/write?open=drive` and
`/settings#drive` work on a fresh load. The headers stop other sites from
framing the app (clickjacking of Connect Drive, Save, Import and Settings),
turn off MIME sniffing and keep the browser's default referrer policy, which
still sends the origin that the Picker key's website restriction checks
(`src/test/deployHeaders.test.ts` checks them).

Steps:

1. Link the project: `vercel link` (the `.vercel/` folder is git-ignored).
2. Add the Google values for each environment you deploy (production,
   preview). They are the only way Drive gets switched on: writers have
   nowhere to enter them, so a deployment built without them has no Google
   Drive at all. For example:

   ```bash
   vercel env add VITE_GOOGLE_CLIENT_ID production --type config
   vercel env add VITE_GOOGLE_API_KEY production --type config
   ```

   Store them as **config**, not secrets. Every `VITE_*` value is inlined into
   the JavaScript bundle at build time, so anyone who loads the site can read
   it. That is by design: an OAuth client id is public in every browser OAuth
   flow, and the Picker key is protected by its website and API restrictions,
   not by secrecy. Marking them "secret" would add no protection. Never put an
   AI key in a `VITE_*` variable.
3. Deploy: `vercel` for a preview, `vercel --prod` for production. Env
   changes need a new build to take effect.
4. Add the production origin (and any custom domain) to the OAuth client's
   **Authorized JavaScript origins**, and `https://<domain>/*` to the API
   key's website restrictions ([Google Cloud setup](#google-cloud-setup)).
   Vercel preview deployments get their own URLs; Google sign-in works on them
   only if those origins are added too.

## Privacy and security model

- **No server.** Nothing about the writing is sent to Thunder Writer, because
  there is nothing to send it to. The deployment is static files.
- **Suggestions:** the Suggestion form sends only what the writer types in it
  (and an email, if they give one) from the browser to FormSubmit
  (`formsubmit.co`, or `VITE_SUGGESTION_ENDPOINT`), which emails it to the
  developer. The manuscript is never sent.
- **Manuscripts:** stored in IndexedDB (`thunder-writer` database) in this
  browser, and in the writer's Google Drive if connected. Reference files are
  in the `thunder-writer-context` database. Desktop-copy file handles are in
  `thunder-writer-export`.
- **Keys:** Claude/OpenAI keys are stored in this browser's `localStorage`
  (`thunder-writer:settings`) and sent only to their own provider. The trivia
  cooldown keeps only a timestamp in `localStorage`. A "web search
  unavailable" note for the tab stores the provider, model and a short
  non-reversible fingerprint of the key, never the key itself.
- **AI requests** go directly from the browser to `api.anthropic.com` or
  `api.openai.com`, using the SDKs' `dangerouslyAllowBrowser: true` option
  (the SDKs refuse to run in a browser without it, because a key in a web page
  is exposed to that page). Requests contain the manuscript (or, for long
  books, the opening plus the region around the cursor), reference files
  (capped), and recent suggestion titles. How the provider handles API data is
  governed by its own API terms.
- **Web-searched trivia:** when on, the provider may send short search queries
  derived from the manuscript to its search backend. The prompt asks the model
  to search by topic or place, never the writer's sentences, character names
  or plot, but the model writes the query itself. Turn the toggle off to
  prevent this.
- **Google:** the OAuth access token is kept in memory only, never in storage.
  The only scope is `drive.file`.
- **Untrusted content:** AI output, imported documents and search results are
  treated as data. AI text is rendered as React-escaped plain text; source
  links are restricted to http/https; imported HTML is stripped of scripts,
  frames, forms, styles and links; the Book Preview builds DOM from the
  editor schema with no `innerHTML`. Prompts tell the model never to follow
  instructions found inside the manuscript, reference files or search results.
- **Framing and headers:** `vercel.json` sends `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy:
  strict-origin-when-cross-origin` on every path, so no other origin can embed
  the app in an iframe. Other hosts need the same headers configured.
- **CSP:** the only directive set is `frame-ancestors`; there is no
  script, connect or frame policy yet (no `<meta
  http-equiv="Content-Security-Policy">` in `index.html` either). A full policy
  would be a useful hardening step against XSS reading keys from
  `localStorage`. It hasn't been added because it can't be checked here against
  real Google sign-in, the Picker and both providers. It would need to allow at
  least `connect-src` for `api.anthropic.com`,
  `api.openai.com`, `www.googleapis.com` and `formsubmit.co` (the Suggestion
  form), plus the Google Identity Services
  and Picker script and frame origins (`accounts.google.com`,
  `apis.google.com`, `docs.google.com`). Test it against sign-in, the Picker
  and both AI providers before shipping.
- **Trade-off:** a key in `localStorage` can be read by any script running on
  the page's origin, such as a malicious browser extension or an XSS bug. That
  is the price of having no backend to hide it behind. To limit the risk:
  - Use a dedicated key with a low spending limit.
  - Don't use Thunder Writer on shared machines.
  - Revoke the key if in doubt.
  - Use **Settings → Clear all local data** to wipe everything the app stored
    in the browser (IndexedDB databases and `localStorage` keys whose names
    start with `thunder-writer`). Drive files are not touched.

## Architecture

```
src/
  main.tsx, App.tsx        Router + routes; StorageProvider wraps everything
  types.ts                 Shared domain types (ThunderDoc, DocFormat, Suggestion, …)
  contracts.ts             EditorBridge: how the suggestions pane talks to the editor
  store/
    settings.ts            Persisted settings (localStorage, versioned + migrated),
                           default models, SETTING_BOUNDS
    documents.ts           In-memory documents; storage hydrates and subscribes
    session.ts             Suggestions, accepted count, AI usage/cost for this session
    pendingEdits.ts        Flush the editor's debounced edits on demand (Cmd/Ctrl+S)
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
    storage/               IndexedDB persistence, cross-tab sync (BroadcastChannel),
                           Google auth (GIS token model), Drive client, Drive
                           autosave scheduler, conflict resolution, FileMenu and
                           dialogs, Google Picker loader and Drive import
                           (picker.ts, driveImport.ts), Clear all local data
    import/                importManuscript(): .docx (mammoth, lazy-loaded), HTML/Google
                           Docs, Markdown and text → TipTap JSON; chapter/scene-break
                           detection; ImportHost (progress/result dialogs), drag-and-drop
    export/                Export (docx, Markdown, text, print HTML, backup; PDF via preview),
                           desktop copy (File System Access API), Cmd/Ctrl+S
    preview/               Book Preview: book paginator, layout engine, flip-book
                           viewer, navigation, header/footer settings and panel, print
    settings/              SettingsPage, key testing
```

**Contracts.** Features talk through small interfaces in `src/contracts.ts`
rather than each other's internals. The main one is `EditorBridge`, which the
editor implements (`createEditorBridge`) and the suggestions feature consumes:
plain text, text near the cursor, find/highlight a quote, replace a quote as
one undoable edit. The export feature's `index.ts` deliberately does not
re-export the converters, so the `docx` library stays in a lazy chunk; call
`buildExport(doc, kind)` from `formats.ts` when a file is needed.

**Data flow.**

1. `StorageProvider` loads documents from IndexedDB into `useDocuments` and
   writes changes back (about 500 ms after a change). After each write it
   broadcasts the docs it wrote; other tabs adopt any newer copy
   (`crossTab.ts`), so tabs converge instead of the last writer silently
   winning.
2. `WriterPage` opens the current document in TipTap and debounces edits into
   the store (400 ms).
3. The suggestions engine reads text through the `EditorBridge`, calls the
   provider, and keeps only suggestions whose quoted passage is actually in the
   document.
4. Accept replaces that passage as one undoable edit.

Anything loaded from storage, Drive or the network is validated with zod
(`storage/schema.ts`, `suggestions/schema.ts`). Note that `z.object` strips
unknown keys, so a new persisted field on `DocFormat` must be added to
`formatSchema` or it silently disappears on reload and Drive sync.

**Editor pagination** (`editor/pagination.ts`) is pure page-break math: it
returns spacer heights that push content onto the next page sheet in the
continuous editor. It runs about 150 ms after typing stops, keeps at least two
lines of a paragraph on each page, keeps headings with the next line, and,
with **Chapters start new page** on, starts every H1 on a new page.

**Book presets** (`editor/presets.ts`): mass-market 4.25 × 6.87, trade 5 × 8,
5.25 × 8, 5.5 × 8.5 and 6 × 9 (default), Royal 6.14 × 9.21, and manuscript
8.5 × 11 double-spaced, each with margins, font, size and line height close to
a small-press or KDP/IngramSpark interior. Fonts are local serif stacks
(Garamond, Palatino, Baskerville, Iowan Old Style, Charter, Georgia, Times New
Roman, Courier); nothing is loaded from a font CDN, so the writer's installed
fonts decide the exact metrics.

## Import pipeline

Code: `src/features/import/` (`importManuscript()`), with Drive import in
`src/features/storage/driveImport.ts` and `picker.ts`.

The import becomes a new Thunder Writer manuscript that autosaves to the
browser and, once Drive is connected, to Drive. **The original file is only
read**, whether on the computer or picked in Drive, unless the writer chooses
**Keep saving to it** after File › Open from computer (Chrome/Edge). Then the
file is kept in Backups first and becomes the manuscript's desktop copy (see
[Opening a file and saving back into it](#opening-a-file-and-saving-back-into-it)).

Entry points:

- **From the computer:** **File › Open from computer…**, dropping a file
  anywhere on the writer page, or **Import a manuscript** on the home page. If
  several files are dropped, only the first is imported (the result says so).
  Open from computer also takes Thunder Writer files (`.thunder.json`, and the
  `.bak` Thunder Writer keeps in Drive): one opens as that manuscript, and
  replacing another version of it in this browser asks first and keeps that
  version in Backups. See [Opening and saving back](#opening-a-file-and-saving-back-into-it).
- **From Google Drive:** **File › Import from Google Drive…**, the **import it
  from Google Drive** link on the home page, or the Google Drive button in the
  import prompt. Google Docs need no download first. The Picker opens on
  **Google Docs & Word**, a flat list of every importable file wherever it is,
  then **Shared with me**, **Browse folders**, **Shared drives** and
  **Thunder Writer saves**. All of these appear only when the build has the Picker key
  (`VITE_GOOGLE_API_KEY`); without it the import prompt and errors point
  Google Docs writers to **File › Download › Microsoft Word (.docx)** instead.
  A Google Drive for desktop `.gdoc` file on the computer is only a shortcut;
  it is refused with a pointer to this route.

| Format | What comes across |
| ------ | ----------------- |
| Word `.docx` | Paragraphs, Title and Heading 1–3 styles (Heading 4–6 become H3), bold, italic, underline, strikethrough, highlight, lists, quotes (Word's Quote style), typed spacing and tabs. Automatic heading numbers (Word's "Chapter 1" heading list numbering) are written into the heading text. The visible Title paragraph names the manuscript, ahead of the file's document properties. Footnotes are kept as a numbered list at the end. Images and comments are left out, and the result dialog says how many. |
| Google Docs | Exported as HTML through the Picker, keeping the same formatting as `.docx`. A Doc too large for Google to export (about 10 MB) must first be downloaded as `.docx` and imported from the computer. |
| `.html` | Headings, paragraphs, marks, lists, quotes and centre/right alignment. Scripts, frames, forms, styles and links are stripped; link text is kept. |
| `.md` | Headings, emphasis, strikethrough, `<u>…</u>` underline, `==…==` highlight, quotes, nested lists, scene breaks, and a `title:` in front matter. A leading `---` counts as front matter only if every line up to the next `---` is YAML; otherwise it is a scene break and nothing is dropped. A `---` under a sentence is a scene break, not a heading. A first `# Title` above the chapters names the manuscript and isn't counted as a chapter. |
| `.txt` | Paragraphs split by blank lines, or one paragraph per line. Lines are joined only when the whole file is hard-wrapped at one width (the dialog says so). A longer gap than usual between paragraphs is kept as an empty line. A short first line above the chapters names the manuscript. |

**Encoding.** Text, Markdown and HTML files are read as UTF-8, UTF-16 (with a
byte-order mark) or Windows-1252, and HTML honours its `<meta charset>`. A
mostly UTF-8 file with a few stray legacy bytes keeps its UTF-8, and only
those bytes are read as Windows-1252 (`decode.ts`). Files picked in Drive are
decoded the same way.

**Limits and refusals.** Files must be 25 MB or smaller, from the computer or
from Drive; a larger Drive file is stopped during the download. `.docx` files
also get a decompressed-size check on their XML parts, to stop a "zip bomb"
before mammoth parses it (`limits.ts`, `zip.ts`). Old `.doc`,
password-protected `.docx`, PDF, RTF, ODT, Pages, EPUB and Scrivener projects
are refused (`sniff.ts`), with a message on how to export them as `.docx` or
plain text.

**Chapters and scene breaks** (`chapters.ts`, `structure.ts`). A standalone
line such as "Chapter 1", "CHAPTER ONE", "Chapter Twelve: The Storm", "Part
One", "Prologue" or "Epilogue" becomes a Chapter heading (H1), so it starts on
a new page when **Chapters start new page** is on. So does "Chapter 4"
followed by its title on the next line (Shift+Enter) in the same paragraph.
Bare numerals like "IV" or "12" are promoted only if at least two appear
counting up (I, II, III), so a "XXX" to-do marker stays text. Paragraphs
separated only by `<br><br>` in HTML are split into separate paragraphs. A
sentence that just begins with "Chapter…" stays a paragraph. Lines such as
`* * *`, `***`, `#`, `~~~` or `§` become the scene-break divider. The words
themselves are never changed; only empty paragraphs and trailing spaces are
tidied.

After the import, a dialog shows the word count, the chapter count, and
anything that was left out.

### Opening a file and saving back into it

`src/features/import/openFromComputer.ts`. **File › Open from computer…**
works like a desktop app's Open in Chrome and Edge (File System Access API:
`showOpenFilePicker`):

- The file opens as above, and the dialog offers **Keep saving to
  “<file>”**. That click asks the browser for write permission (it must come
  from a click; the picker's own click has usually expired by then). Then the
  file as it is now is kept byte for byte in Backups (`'original-file'`,
  downloadable exactly as it was), and the file becomes the manuscript's
  desktop copy (`linkDesktopCopy`). From the next change on it is rewritten
  in its own format (`.docx`, `.md`, `.txt` or `.thunder.json`) like any
  desktop copy, and Cmd/Ctrl+S writes it at once. Rewriting a `.docx` from the
  manuscript drops what only Word keeps (comments, tracked changes, images);
  the dialog says so. HTML and `.bak` files are never written to.
- **A file is never written over after it changed elsewhere.** Every write
  into a desktop copy (an opened file or one set up with **Keep a copy on my
  computer**) first compares the file's modification time with the one
  recorded at Thunder Writer's last write (`fileModifiedAt`, with 2 s of
  slack). If it is newer, the file is kept byte for byte in Backups at once,
  saving to it pauses (autosave, Resume and Cmd/Ctrl+S all wait), and the
  writer is asked which version to keep (`holdForChoice`). **Use the file’s
  version** reads the file again, keeps this browser's version in Backups first
  (asking if that fails), loads the file's words, and marks the two in sync, so
  nothing is rewritten until the next edit. **Keep this browser’s version**
  writes over the file, confirming first if its backup failed. Closing the
  question leaves saving paused; the header badge or Cmd/Ctrl+S brings it back.
  After a reload, a copy is caught up only if the manuscript changed since the
  version the file holds (`docUpdatedAtWritten`), never by comparing the file's
  clock with the manuscript's.
- Opening a file that already saves back to a manuscript
  (`FileSystemHandle.isSameEntry` against the stored handles) goes to that
  manuscript instead of making a second one, with the same check.
- Firefox and Safari have no way to write back into a picked file: Open from
  computer is a plain file chooser there, and the dialog says that Export to
  computer saves a copy any time.

## Focus Mode and typewriter sounds

**Focus Mode** (`src/features/editor/focusMode.ts`; toolbar button after
Headers & footers…, in the app icon's navy). Turning it on hides the header,
toolbar, status bar and page details, and unmounts the suggestions pane, so
the engine pauses instead of making suggestions nobody sees. The pages then
fill the window, with **Exit Focus Mode** floating at the top. Esc also
exits, except while a dialog is open; it is caught in the capture phase
because the editor handles Esc itself. The switch is a View Transition
(`document.startViewTransition` + `flushSync`) where the browser has one:
named parts animate on their own (the header lifts, suggestions slide right,
the status bar drops, the exit button drops in), and the pages glide at their
natural size. Both snapshots of the pages slide by the extra room above them
(`--ed-focus-drop`, directed by `html.tw-entering-focus` /
`tw-leaving-focus`), so they never show twice. Without View Transitions it is
a short fade; with reduced motion, instant. Leaving the writer page turns it
off.

**Typewriter sounds** (`typewriterSounds.ts`, `useTypewriterSounds.ts`; a box
after "Chapters start new page"; `typewriterSounds` in settings, off by
default). The sounds are synthesised with the Web Audio API, so there are no
audio files. The voice is a clicky mechanical keyboard (blue switches, with a
nod to the IBM Model M), built in layers so it isn't flat:

- **Press:** the click jacket's 4–6 ms bright snap; a few ms later the key
  bottoming out, as a band-passed plastic clack over a falling triangle tone
  for the case; and a faint metallic spring ring.
- **Release:** a second, quieter click when the key comes up (`keyup`).
- **Space bar and Enter:** a deeper, heavier stroke with a stabilizer's rattle.
- **Backspace and Delete:** a lower, hollower clack with that rattle, clearly
  unlike a letter.

Everything runs through a short generated "room" (a 90 ms convolution
impulse) and a gentle compressor. Nothing plays for shortcuts, arrows or IME
composition, or outside the manuscript. Each stroke varies a little, and
presses are at least 18 ms apart. The audio context starts on the first key
press (browsers need a gesture), and ticking the box plays a sample.

## Saving to the computer (export, PDF and desktop copy)

Code: `src/features/export/` (mounted by `WriterPage` via `<ExportHost />`,
which also runs the desktop-copy service and the Cmd/Ctrl+S handler).

- **Export ▾** (the first row of controls, after **File**; also
  **File › Export…**) saves a one-off copy of the open manuscript as:
  - Word `.docx` (recommended): book trim size, mirrored margins (gutter at
    the spine, patched in as `w:mirrorMargins` because the docx library has no
    option for it), font, size and line spacing, chapters as Heading 1, page
    numbers, and the Book Preview's header and footer settings. When chapters
    start a new page, each chapter is its own Word section (an odd-page break
    when chapters open on a right-hand page), so its "different first page"
    header can drop the running head on the opener. The `docx` library is
    loaded lazily, only when a Word file is built.
  - Markdown or plain text. These leave out the manuscript title (the file
    name carries it) so a re-import doesn't gain an extra paragraph. Markdown
    also drops alignment and leading indentation, and writes underline as
    `<u>…</u>`.
  - **PDF**: opens Book Preview, which prints every page as soon as the
    layout is done (`printOnOpen`; `preview/pdfRequest.ts`) and then closes.
    The print dialog's **Save as PDF** makes the file, named after the
    manuscript (the page title is the manuscript's while printing). So the PDF
    is exactly the preview's pages (trim size, running heads, folios), with no
    second typesetting engine or embedded fonts to maintain. Tested in Chromium.
  - A print-ready `.html` page.
    Its page-number margin boxes need Chrome 131+ or another browser that
    supports CSS page-margin boxes. Print colours are fixed to black on white.
  - A `.thunder.json` backup (the same envelope as Drive files).
- In Chrome and Edge the native Save dialog (`showSaveFilePicker`) opens on the
  Desktop. Elsewhere, or if the dialog is blocked, the file is downloaded
  through a temporary link and lands in Downloads (the browser's "Ask where to
  save each file" setting lets the writer pick the Desktop).
- **Keep a copy on my computer** (Chrome/Edge, File System Access API): choose
  a file once; it is rewritten about 15 s after a pause (at least every 30 s
  while typing), when the tab is hidden, when the writer switches manuscript,
  and on Cmd/Ctrl+S (`copyScheduler.ts`: single-flight, retries, and pauses
  when permission is lost or the file is gone). The file handle is kept per
  manuscript in IndexedDB (`thunder-writer-export`). After a reload the browser
  asks for write permission again: click **Resume copy** in the header or press
  Cmd/Ctrl+S. Deleting a manuscript stops its copy and forgets the handle (the
  file on disk is left alone); **Clear all local data** removes the handles
  too.
- **Cmd/Ctrl+S** is caught everywhere on `/write`, including inside the
  editor, so the browser's "Save page" dialog never opens. It pushes the
  editor's debounced keystrokes into the store, writes IndexedDB immediately
  and waits for it before saying "Saved in your browser", then writes the
  desktop copy if there is one (or opens **Export** the first
  time). Cmd/Ctrl+**Shift**+S is left to the editor (strikethrough).
- **Round trips are tested** (`src/features/export/roundtrip.test.ts`): a saved
  `.docx`, `.md` or `.txt` re-imported with **File › Open from computer…** comes
  back with the same words, chapters, sections and scene breaks, and (Word and
  Markdown) the same bold, italic, underline, strikethrough, highlight, lists
  and block quotes.

## Book Preview and pagination

Code: `src/features/preview/`. Opened from the toolbar's **Preview Book** button as
`<BookPreview docId onClose … />`, a full-screen portal dialog (z-index 1000)
that loads its own CSS, traps focus (with a document-level key and focus
backstop) and returns focus to the opener on close.

**What it does (user-facing).** Two-page spreads with page 1 alone on the
right; chapters open on right-hand pages, with blank left pages inserted as
needed; running heads and page numbers; facing pages balanced to end on the
same line; no orphaned headings, stranded scene breaks or runt chapter
endings. Turn pages with ← → / PageUp / PageDown / Home / End, the side
buttons, a click on a page's outer edge, a drag or swipe, or the mouse wheel /
trackpad. The bottom slider jumps anywhere (hover shows the chapter), and
Contents, Go to page and All pages (arrow keys work) help moving around.
Single-page mode switches on automatically for narrow windows, and there is a
toggle. Reduced-motion settings get instant changes with a cross-fade.
**Print / PDF** prints every page at the exact trim size.

**Paper & ink** (`printSettings.ts`; stored on `DocFormat.print`, read through
`normalizePrint()`): interior paper (White, Cream, Groundwood) and ink (Black
and white, Standard color, Premium color), each with a note on what it is for.
Color is printed on white paper, so a color ink rules out the others. Only the
pages' look changes: the paper tone, groundwood's grain, a deeper black for
premium color. It is kept out of the layout options, so changing it never
re-typesets the book, and the PDF and exports print on whatever paper the
printer uses. Default: cream and black and white, the standard for novels.

**Settings** (`headerFooter.ts`, `HeaderFooterPanel.tsx`) are stored per
manuscript on `DocFormat.headerFooter` and `DocFormat.bookLayout`, and always
read through `normalizeHeaderFooter()` / `normalizeBookLayout()`, which
validate and bound whatever was stored.

- `HeaderFooterSettings`: `versoHead` / `rectoHead` each one of none, title,
  author, chapter or custom (default **author on the left, title on the
  right**, the trade-fiction standard), custom texts, author name (falls back
  to the title), footer line (none/title/author/custom), `pageNumbers`
  (`footer-center` default, `footer-outside`, `header-outside`, `none`),
  `firstPageNumber`, `suppressOnChapterOpeners` (default on; a top folio then
  drops to the foot, `openerFolio`), `suppressOnBlankPages` (default on),
  small-caps heads at 80% of body size, and `shortHeads` (chapter title →
  short running head, at most 500 entries of 200 characters). Presets:
  Author / Title, Title / Chapter, Chapter on both pages, Title on both pages.
- `BookLayoutOptions`: `chaptersStartRecto` (default on), `justify` (default
  on), `chapterSink` (how far down a chapter heading sits; default one third).
- `resolveHeaderFooter()` is a pure function returning what prints on each
  page. The panel measures heads and the footer line at the trim size
  (`fitText.ts`) and warns when they don't fit.
- The same settings drive the Word and print-HTML exports (Word: different
  odd/even headers, one section per chapter so openers can suppress the head).
  The preview's own Print / PDF is the faithful output; Word's widow control
  decides its own breaks, so balanced spreads and the runt rule are not
  reproduced in `.docx`.

**Engine.**

- `renderModel.ts` validates (or sanitises) the stored JSON against the editor
  schema and serialises it to DOM elements, with no `innerHTML`. Unknown nodes
  and marks (links with `javascript:`, iframes, scripts) are dropped.
- `measure.ts` / `layout.ts` measure chunks in an offscreen, inert container
  that uses the editor's CSS metrics; real line boxes come from
  `Range.getClientRects`. `layout.ts` calls `retainLines()` before each new
  measuring chunk, because line boxes and long-paragraph line starts are exact
  only while the chunk is mounted.
- `paginateBook.ts` is a separate paginator from the editor's (which returns
  spacer heights for continuous scroll): the book needs per-page slices of
  blocks and real line boxes. A test checks both give the same page count for
  plain text. It lays out **a spread at a time** and commits pages one spread
  behind the input. With `linePitch` set it applies a baseline grid, **spread
  balancing** (in order of preference: full depth, −1 line, +1 line when
  `longPageDepth()` allows it, −2, then re-setting the previous spread, then
  allowing an orphan (never a widow), then −3) and a **runt rule** (at least 5
  lines on a chapter's last page, by taking lines from the facing verso or
  re-setting the previous spread). Headings and scene breaks are kept with the
  next legal slice. `BookPageModel.depth` records the chosen depth.
- `longPageDepth()` allows a long page only when the extra line stays half a
  line clear of a page number drawn at body size.
- A paragraph split across pages is rendered whole on each page and clipped at
  the line boundary. Plain paragraphs over 60 lines are cut at line starts
  instead, to keep the DOM small.
- Work runs in short time slices and yields more often during a page turn.
  Finished layouts are cached by content, format and layout options (up to 4
  kept). Header/footer changes never re-lay out. When a layout option changes,
  `anchor.ts` records the first text in view and the reader stays on the old
  layout until the new one reaches that text.
- The book's page count differs from the editor's (blank versos before recto
  chapter openings, chapter sinks, balanced spreads): about 400 against 389 for
  the 120k-word test manuscript. The editor's numbers are manuscript pages.

**Viewer.** `FlipBook.tsx` / `flip.ts` turn pages with a 3D rotation around
the spine plus moving shading, via the Web Animations API (compositor-driven).
Perspective is 10 page widths, and the fit reserves room for the leaf's growth
mid-turn. Presses during a turn queue up and run faster, and a queue of more
than 3 becomes a single turn; far jumps are one turn, and the scrubber and
thumbnails cross-fade. Only the pages in view plus the neighbouring spreads
are mounted (at most 6 pages). `navigation.ts` holds the turn/queue state
machine, `spreads.ts` the page-to-spread mapping, `Scrubber.tsx`,
`OverviewGrid.tsx` (virtualised thumbnails) and `PrintBook.tsx` (mounts all
pages only while printing) the rest.

**Dev harness.** `src/features/preview/dev/PreviewHarness.tsx` is a
development harness the app never imports. The Playwright harnesses and
critic scripts used for browser checks lived in a session scratchpad and are
not in the repo.

## Performance

Measured in headless Chromium (Playwright, 1440×900) on generated
manuscripts of about 118,000–119,000 words, 40 chapters, 40 scene breaks, at
6 × 9. These are one-machine measurements, not guarantees.

**Import and editing** (dev server; production figures in brackets):

| Measure | Result |
| --- | --- |
| Import `.docx` / `.txt` / `.md` | 342 ms (235 ms) / 201 ms / 233 ms |
| Fully paginated in the editor after import | 0.53–0.69 s (566 ms); 389 pages |
| Pagination pass after an edit | about 8 ms (was about 78 ms before optimisation) |
| Typing at 150 ms per key | p95 35 ms, max 40 ms (p95 34.7 ms, max 44.6 ms), no long tasks |
| Quote lookup for a suggestion (`hasQuote`) | 18 ms cold, then about 0.2 ms (was 3.3–3.5 s) |
| IndexedDB autosave | 2.5–7.6 ms synchronous, 11–23 ms to complete |

Debounces confirmed: 400 ms store flush, 500 ms IndexedDB, 250 ms word count,
150 ms pagination. `getJSON` runs only on the debounced flush, not per
keystroke.

**Book Preview** (400-page result):

| Measure | Result |
| --- | --- |
| First spread ready (engine) | 12–20 ms (43–55 ms at 4× CPU slowdown) |
| First page on screen from mount | 70–100 ms |
| Full layout | 102–126 ms (about 1 s at 4× slowdown) |
| Long tasks during layout | none |
| Page turns | p95 16.7 ms; 0 long tasks during turns |
| Print mount / PDF of the 400-page book | 167 ms / 0.76 s |
| Stress document (300-paragraph quote + a 15,000-word paragraph) | layout 59 ms, PDF 0.32 s |
| Text completeness check, every page rendered | 0 lost, 0 duplicated, 0 straddling words |
| Spread balance (big doc) | 1 ragged spread of about 200 (was 75) |

## Testing

```bash
npx tsc -b --noEmit   # type-check
npx vitest run        # unit and component tests (jsdom)
npx vite build        # production build
```

At commit 4b264d6 all three are clean, with 816 tests in 67 files.

- Tests are colocated as `*.test.ts(x)` and run in jsdom
  (`src/test/setup.ts`). Most logic is written as pure modules so it can be
  unit-tested without a browser: pagination, the suggestion scheduler, prompt
  building, sanitising, pricing, trivia parsing, the Drive client and autosave
  scheduler, cross-tab sync, the desktop-copy scheduler, import converters,
  chapter detection, and the preview's paginator, spreads, navigation and
  header/footer resolution.
- External services are faked: the AI SDKs are mocked and requests are checked
  against the installed SDK types; Google sign-in, gapi, the Picker and Drive
  use fakes and a fake `fetch`.
- jsdom has no layout, so the preview paginator is fed synthetic line boxes,
  and the layout engine runs with a fake measurer and a synchronous scheduler.
  Real-layout behaviour (page counts, clipping, frame timing, print) was
  checked in headless Chromium with Playwright scripts outside the repo.
- Round-trip tests export and re-import `.docx`, `.md` and `.txt`.
- `BookPreview.test.tsx` hides React's "not wrapped in act" notice, which
  comes only from timer-driven layout and animation updates that its `waitFor`
  calls already await. Other console errors still print.
- There is no ESLint config in the repo.

## Known limitations

**Suggestions**

- Long manuscripts: past 16,000 characters (about 2,700 words) the prompt
  carries only the first 4,000 characters and about 8,000 characters around
  the cursor, plus reference files. There is no chapter outline or summary,
  so continuity with a middle chapter (a name from Chapter 3 while writing
  Chapter 12) can't be caught unless it's in a reference file.
- For models not in the pricing table the engine adds $0, the pane footer says
  "cost unknown for <model>", and the status bar shows $0.0000 for those
  requests.
- Suggestions are not tied to a document. After switching manuscripts, open
  cards from the old one stay listed until resolved; their quotes won't be
  found, so highlight and accept show a "passage has changed" note.
- Automatic mode needs `EditorContext.editor` (typing is detected with
  `editor.on('update')` while the editor has focus). With only the bridge,
  manual Generate still works but automatic requests never fire.
- Reference files can't be `.docx` or `.pdf` (reading them in the browser
  would need new dependencies); the writer is told to save a `.txt` copy. RTF
  text extraction is a simple approximation and may leave stray text from
  unusual RTF groups.

**Editor**

- Page breaks are computed about 150 ms after typing stops, so text can
  briefly overlap a page gap while typing.
- Page splitting assumes every line in a paragraph has the same height. A
  block that can't be split and is taller than a page runs past the page.
- Spacing in lists and block quotes is estimated, so breaks inside them are
  close but not exact line by line.
- When a break falls mid-paragraph in justified text, the last line on that
  page shows left-aligned.
- Font, size and line spacing apply to the whole book; there is no control for
  the font of selected text.
- If storage replaces the current doc's content while the writer typed in the
  last 400 ms, those keystrokes are dropped in favour of the loaded content.
- The editor uses `hyphens: manual` (no automatic hyphenation).

**Storage and Drive**

- The Drive token lasts for the browser session; after a reload the writer
  clicks Connect again. Documents linked to Drive show "Saved locally · Drive
  paused" until then.
- Opening from Drive lists only files in the "Thunder Writer" folder created
  with `drive.file`. Files moved elsewhere in Drive won't appear.
- Nothing is uploaded to Drive when the page closes.
- Markdown files that Drive stores with a generic MIME type (such as
  `application/octet-stream`) are hidden by the Picker's type filter.
- The Picker's `setOrigin` is set to `window.location.origin`; it's documented
  for apps inside an iframe and has not been checked in a real browser.
- After a Drive import finishes, keyboard focus stays on the dialog rather
  than moving to "Start writing" (the result is announced to screen readers).

**Import**

- Conversion runs on the main thread. A novel takes well under a second, but a
  25 MB `.docx` with a huge `document.xml` could freeze the tab for a few
  seconds (a Web Worker would fix this).
- Word paragraph alignment is lost (mammoth doesn't output it); centred
  chapter and scene-break lines are still recognised from their text.
- Superscript and subscript aren't in the editor schema, so footnote markers
  show as plain text like "[1]".
- Where the browser has no `DecompressionStream`, only declared zip sizes are
  checked, and the Word metadata title and comment count are skipped.
- Markdown support is deliberately small: no tables, reference-style links or
  raw inline HTML (kept as literal text); code blocks become paragraphs.
- A single bare "I" in a one-chapter file stays a paragraph (bare numerals
  need at least two). Scene-break lines are recognised without checking
  alignment, so a lone "—" paragraph always becomes a break.

**Export and desktop copy**

- Two tabs with a desktop copy of the same manuscript both write the same
  file; the contents match, but the browser may briefly report the file busy
  (a retryable error).
- Word prints headers on the blank page that an odd-page section break
  inserts (chapters opening on right-hand pages): the "nothing on blank pages"
  setting doesn't reach Word.
- With **Chapters start new page** off, the print `.html` file shows the book
  title where a "chapter" running head goes. Chrome doesn't support
  `string-set`, and putting each chapter on a named page would force a page
  break before it. Word uses a `STYLEREF "Heading 1"` field in this case, and
  the preview and editor sheets show the chapter. The Headers & footers panel
  says so when a chapter head is chosen.
- In the print `.html` file, `@page :left / :right` go by physical position
  (the first page is always `:right`). When the first page number is even,
  the rules are swapped so each page keeps its folio's side; chapters that
  open on a right-hand page then use `break-before: left`, which Chrome, like
  `right`, treats as a plain page break.
- While Book Preview is open, Cmd/Ctrl+S saves in the browser and writes an
  existing desktop copy, but never opens **Export** (it would
  sit hidden behind the full-screen preview). The toast says to close the
  preview first. The preview shortcut (Cmd/Ctrl+Alt+P) does nothing while
  another modal dialog is open.
- Each Word section's break is stored on the chapter's last paragraph
  (`mergeSectionBreaks` in `toDocx.ts`); the docx library would otherwise add
  an empty paragraph per section, which can push a stray blank page.
- In Word, balanced spreads, one-line-long pages and the runt rule from Book
  Preview are not reproduced; Word's own widow control decides the breaks.
- If IndexedDB is blocked (some private windows), a desktop copy works until
  the tab closes but won't survive a reload, and the app doesn't say so yet.

**Book Preview**

- Spread balancing trades ragged spreads for other compromises. In the 120k
  doc: 1 ragged spread of 200 remains, 40 pages run one line long, 33 orphans
  appear (only after the strict options fail), and 5 pages are three lines
  short. Long pages and orphans can't be switched off from
  `BookLayoutOptions`.
- A custom format with very small bottom margins never runs a page long.
- A paragraph split across pages is rendered whole and clipped, so a screen
  reader or Find in page can meet the lines at a page boundary twice. Text
  selection is off in the preview.
- No hyphenation, so justified text shows some loose lines ("Justify text" can
  be turned off).
- An empty line made by two hard line breaks inside one paragraph isn't
  measured as its own line, so a page can't break there. Blocks taller than a
  page overflow, as in the editor.
- No front matter (half-title, title page, copyright, contents); the first
  page number can offset numbering instead. The "chapter" running head uses
  H1s only, and on a page where a chapter starts mid-page it shows the first
  chapter starting there.
- Short heads are keyed by chapter title, so renaming a chapter drops its
  short head (the panel then flags the new title if it's too long). Heads
  still too wide at 72% size are clipped without an ellipsis, and the panel
  flags them.
- Scene-break ornaments can still start a page (5 times in the big doc).
- Emptied list and quote paragraphs keep their DOM elements; line-start
  cutting covers only plain paragraphs over 60 lines.
- Layout waits up to 1.5 s for web fonts; a font that arrives later isn't
  reflected until content, format or options change.
- When an option changes, the reader stays on the old layout until the new one
  reaches the anchored text, and Print / PDF is disabled until the new layout
  is finished.
- Wheel handling is one page per gesture; spinning a notched wheel without
  pausing turns once until 220 ms of quiet.
- On a CPU 4× slower than the test laptop, a turn in roughly the first second
  (while layout runs) can drop one frame. Headless Chrome showed about 3 slow
  frames (33 ms) per 2,000 during turns, cause unknown.
- The page turn is a rigid rotation with shading, with no paper curl.
  Thumbnails are simplified schematics.
- Print / PDF was tested only in Chromium. There are no bleed or crop marks,
  and fonts must be installed locally.

**Platform**

- No Content-Security-Policy is set (see
  [Privacy and security model](#privacy-and-security-model)).
- No service worker, so the app can't be opened offline.
- The UI uses CSS `color-mix()`, which needs a modern evergreen browser.
- The home page was checked down to 520 px wide; phone breakpoints exist but
  a 375 px viewport wasn't checked directly.

## Not yet verified against live services

All of the following were built and tested against fakes, mocks and headless
Chromium only. Watch them the first time they run for real:

- **AI providers:** no live Anthropic or OpenAI calls were made during
  development. Requests were checked against mocked SDKs and the installed SDK
  types (`@anthropic-ai/sdk` 0.129, `openai` 7.25), including web search,
  `pause_turn` resumption, and the `max_tool_calls` fallback. The cost figures
  above are estimates, not checked against a bill.
- **Google:** sign-in, Drive read/write, conflict detection and the Picker were
  tested with a fake Google sign-in object, fake gapi/Picker and a fake
  `fetch`, never with a real Cloud project, client id or API key.
- **File System Access:** the native Save dialog, permission after reload, and
  a desktop-copy file moved or deleted on disk were tested only in jsdom.
- **Output files:** opening exported `.docx` files in Word, Pages or
  LibreOffice, and printing the HTML file, have not been checked by hand. Book
  Preview print was checked only through Chromium's headless PDF export.
- **Other browsers:** Safari and Firefox were not exercised.
