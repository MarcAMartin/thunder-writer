import { useEffect, useState } from 'react'
import { importLocalFile } from './importFlow'

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

/**
 * While mounted (on the writer page), dropping a file ANYWHERE in the window
 * imports it as a new manuscript: on the pages, the toolbar, the Suggestions
 * pane or a dialog. Without this, a file released outside the pages would
 * get the browser's default action and open in the tab, leaving the app with
 * unsaved edits still in the autosave delay.
 *
 * Listeners sit on the window in the capture phase, so the editor never tries
 * to insert the file, and only file drags are intercepted: dragging text
 * inside the editor works as before. If several files are dropped, the first
 * is imported and the result says the rest were left out. Returns true while
 * a file is dragged over the window.
 */
export function useManuscriptDrop(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      over(e)
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      depth = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      const [file, ...rest] = files
      if (file) void importLocalFile(file, { alsoDropped: rest.map((f) => f.name) })
    }
    window.addEventListener('dragenter', enter, true)
    window.addEventListener('dragover', over, true)
    window.addEventListener('dragleave', leave, true)
    window.addEventListener('drop', drop, true)
    return () => {
      window.removeEventListener('dragenter', enter, true)
      window.removeEventListener('dragover', over, true)
      window.removeEventListener('dragleave', leave, true)
      window.removeEventListener('drop', drop, true)
    }
  }, [])
  return dragging
}
