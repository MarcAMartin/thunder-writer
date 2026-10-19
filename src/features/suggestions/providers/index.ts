import type { AIProvider } from '../../../types'
import { claudeProvider } from './claude'
import { openaiProvider } from './openai'
import { openrouterProvider } from './openrouter'
import { thunderProvider } from './thunder'
import type { SuggestionProvider } from './types'

export function getProvider(id: AIProvider): SuggestionProvider {
  switch (id) {
    case 'claude':
      return claudeProvider
    case 'openrouter':
      return openrouterProvider
    case 'thunder':
      return thunderProvider
    default:
      return openaiProvider
  }
}

export * from './types'
