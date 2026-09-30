import { useEffect, useState, type RefObject } from 'react'
import { importLocalFile } from './importFlow'

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

/**
 * Dropping a file on `target` (e.g. the manuscript pages) imports it as a new
 * manuscript. Listeners run in the capture phase so the editor never tries to
 * insert the file, and only file drags are intercepted: dragging text inside
 * the editor works as before. Returns true while a file is dragged over it.
 */
export function useManuscriptDrop(target: RefObject<HTMLElement | null>): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const el = target.current
    if (!el) return
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
      const file = e.dataTransfer?.files?.[0]
      if (file) void importLocalFile(file)
    }
    el.addEventListener('dragenter', enter, true)
    el.addEventListener('dragover', over, true)
    el.addEventListener('dragleave', leave, true)
    el.addEventListener('drop', drop, true)
    return () => {
      el.removeEventListener('dragenter', enter, true)
      el.removeEventListener('dragover', over, true)
      el.removeEventListener('dragleave', leave, true)
      el.removeEventListener('drop', drop, true)
    }
  }, [target])
  return dragging
}
