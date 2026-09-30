/**
 * The Google Cloud project Thunder Writer uses for Drive. It belongs to the
 * deployment, not the writer: the values are baked in at build time from
 * VITE_GOOGLE_* env vars (tech_notes.md → Google Cloud setup) and the app never
 * asks for them. Read on every call so tests can stub the env.
 */

const read = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** OAuth 2.0 Web client id (Google Identity Services token model). */
export const googleClientId = () => read(import.meta.env.VITE_GOOGLE_CLIENT_ID)

/** Browser API key for the Google Picker (importing existing Drive files). */
export const googleApiKey = () => read(import.meta.env.VITE_GOOGLE_API_KEY)

/**
 * The Cloud project number is the numeric prefix of an OAuth client id:
 * "698829428298-abc.apps.googleusercontent.com" -> "698829428298".
 */
export function projectNumberFromClientId(clientId: string): string {
  return /^(\d+)-/.exec(clientId.trim())?.[1] ?? ''
}

/**
 * The Picker's appId. It must be the project that owns the client id, so it is
 * derived from it unless VITE_GOOGLE_PROJECT_NUMBER says otherwise.
 */
export const googleProjectNumber = () =>
  read(import.meta.env.VITE_GOOGLE_PROJECT_NUMBER) || projectNumberFromClientId(googleClientId())

/** False only in a build made without the Google Cloud values; Drive is then left out of the UI. */
export const hasGoogleDrive = () => googleClientId().length > 0

/** Importing existing Drive files (the Google Picker) also needs the browser API key and project number. */
export const hasGooglePicker = () => hasGoogleDrive() && googleApiKey().length > 0 && googleProjectNumber().length > 0
