import type { AIProvider } from '../../../types'
import { claudeProvider } from './claude'
import { openaiProvider } from './openai'
import type { SuggestionProvider } from './types'

export function getProvider(id: AIProvider): SuggestionProvider {
  return id === 'claude' ? claudeProvider : openaiProvider
}

export * from './types'
