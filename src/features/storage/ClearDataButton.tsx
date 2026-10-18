import { useState } from 'react'
import { clearAllLocalData } from './clearAll'
import { isDriveConfigured } from './driveSession'

/**
 * "Clear all local data": after a confirm, deletes everything Thunder Writer
 * keeps in this browser (manuscripts, backups, context files, settings, API
 * keys) and returns to the home page. Used in Settings and on the home page.
 */
export function ClearDataButton({ className = '' }: { className?: string }) {
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
    <button type="button" className={`tw-btn tw-btn-danger ${className}`.trim()} onClick={onClick} disabled={busy}>
      {busy ? 'Clearing…' : 'Clear all local data'}
    </button>
  )
}
