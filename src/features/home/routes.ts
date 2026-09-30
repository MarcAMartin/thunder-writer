/** Route target for the primary "Start Writing" CTA. */
export const WRITE_PATH = '/write'
/** The storage FileMenu reads `?open=drive` to open its Google Drive picker on arrival. */
export const OPEN_FROM_DRIVE_PATH = '/write?open=drive'
export const SETTINGS_PATH = '/settings'
/** The writer's ImportHost reads `?import=local` and shows a "Choose a file to import" prompt. */
export const IMPORT_LOCAL_PATH = '/write?import=local'
/** The storage FileMenu reads `?open=picker` and offers to import a file picked in Google Drive. */
export const OPEN_PICKER_PATH = '/write?open=picker'
