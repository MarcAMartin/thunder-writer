/** The writer page; with no query it opens the manuscript last open in this browser ("Continue Writing"). */
export const WRITE_PATH = '/write'
/** "Start Writing": the writer page reads `?new=1` and opens a fresh manuscript. */
export const NEW_MANUSCRIPT_PATH = '/write?new=1'
/** The storage FileMenu reads `?open=drive` to open its "Open from Google Drive" list on arrival. */
export const OPEN_FROM_DRIVE_PATH = '/write?open=drive'
export const SETTINGS_PATH = '/settings'
export const PRIVACY_PATH = '/privacy'
/** Another address for the Privacy Policy; it redirects to PRIVACY_PATH. */
export const POLICY_PATH = '/policy'
export const TERMS_PATH = '/terms'
/** The writer's ImportHost reads `?import=local` and shows a "Choose a file to import" prompt. */
export const IMPORT_LOCAL_PATH = '/write?import=local'
/** The storage FileMenu reads `?open=picker` and offers to import a file picked in Google Drive. */
export const OPEN_PICKER_PATH = '/write?open=picker'
