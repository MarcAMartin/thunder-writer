import { createContext, useContext } from 'react'
import type { EditorContextValue } from '../contracts'

export const EditorContext = createContext<EditorContextValue>({ editor: null, bridge: null })

export const useEditorContext = () => useContext(EditorContext)
