// Tunable limits for the suggestions feature. Kept explicit so prompt size (and
// therefore cost) is predictable and easy to reason about.

/** Never ask for more than this many suggestions in a single request (design: 1-2 at a time). */
export const MAX_PER_REQUEST = 2

/** Characters of text around the cursor sent as the "focus" excerpt. */
export const FOCUS_CHARS = 1_500

/** Whole manuscript is sent verbatim when it is at most this long. */
export const DOC_FULL_LIMIT_CHARS = 16_000
/** When longer: this many characters from the opening (voice, setup, characters)... */
export const DOC_OPENING_CHARS = 4_000
/** ...plus this many characters of the region around the writer's cursor. */
export const DOC_NEARBY_CHARS = 8_000

/** Total characters of uploaded context files included in a prompt. */
export const CONTEXT_PROMPT_TOTAL_CHARS = 24_000
/** Per-file cap inside the prompt so one long file cannot crowd out the others. */
export const CONTEXT_PROMPT_PER_FILE_CHARS = 12_000

/** Previously shown suggestions listed to the model so it does not repeat itself. */
export const AVOID_LIST_MAX = 30
export const AVOID_ITEM_MAX_CHARS = 120

/** Sanity caps applied to model output before it reaches the UI. */
export const TITLE_MAX_CHARS = 140
export const DETAIL_MAX_CHARS = 1_500
export const QUOTE_MAX_CHARS = 400
/** Web-searched trivia: at most this many cited sources per card... */
export const SOURCES_MAX = 3
/** ...each with a title of at most this many characters... */
export const SOURCE_TITLE_MAX_CHARS = 120
/** ...and a URL no longer than this (longer ones are dropped, never truncated). */
export const SOURCE_URL_MAX_CHARS = 2_048

/** Output token budget for a web-searched trivia request (one short JSON item). */
export const TRIVIA_MAX_OUTPUT_TOKENS = 1_024
/** Searches the provider may run per trivia request. */
export const TRIVIA_MAX_SEARCHES = 1
/** pause_turn continuations allowed for one trivia request. */
export const TRIVIA_MAX_CONTINUATIONS = 1

/** Automatic mode: minimum characters changed since the last request. */
export const MIN_NEW_CHARS = 40
/** Automatic mode: do not bother until the manuscript has at least this much text. */
export const MIN_DOC_CHARS = 40
/** Manual "Generate Suggestions": minimum gap between requests. */
export const MANUAL_MIN_GAP_MS = 5_000
/** How often the scheduler re-evaluates whether to fire an automatic request. */
export const SCHEDULER_TICK_MS = 1_000
/** After consecutive failures the cooldown doubles, up to 2^this. */
export const MAX_BACKOFF_EXPONENT = 3

/** Output token budget per request (2 suggestions of JSON is well under this). */
export const MAX_OUTPUT_TOKENS = 2_048
/** Request timeout for the provider SDKs, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 60_000

/** Context file limits (uploads are stored in IndexedDB in this browser only). */
export const CONTEXT_FILES_IDB_KEY = 'thunder-writer:context-files'
export const CONTEXT_FILE_MAX_BYTES = 2 * 1024 * 1024
export const CONTEXT_FILES_MAX_TOTAL_CHARS = 400_000
export const CONTEXT_FILES_MAX_COUNT = 12
export const CONTEXT_FILE_EXTENSIONS = ['.txt', '.md', '.markdown', '.html', '.htm', '.json', '.rtf'] as const
