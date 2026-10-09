import type { AIProvider } from '../../../types'
import { claudeProvider } from './claude'
import { openaiProvider } from './openai'
import { openrouterProvider } from './openrouter'
import type { SuggestionProvider } from './types'

export function getProvider(id: AIProvider): SuggestionProvider {
  return id === 'claude' ? claudeProvider : id === 'openrouter' ? openrouterProvider : openaiProvider
}

export * from './types'
