import OpenAI from 'openai'
import type { AIUsage } from '../../../types'
import { writerUsd } from '../../thunderAi/plans'
import { openrouterProvider } from './openrouter'
import { SuggestionError, type GenerateRequest, type GenerateResult, type SuggestionProvider } from './types'

/**
 * Thunder Writer AI: prepaid credit on the writer's own OpenRouter key (made
 * when they bought it, see api/ai/claim), so requests go straight from the
 * browser to OpenRouter exactly as with the OpenRouter provider. Only the
 * messages and the cost differ: the writer sees what their credit pays, not
 * OpenRouter's price, and is never told to pick another model.
 */

const toWriterUsage = (u: AIUsage): AIUsage => ({ ...u, costUsd: writerUsd(u.costUsd) })

/** OpenRouter refuses a key that has spent its limit with 402 (or 403 naming the limit). */
function isCreditRefusal(cause: unknown): boolean {
  if (!(cause instanceof OpenAI.APIError)) return false
  return cause.status === 402 || /limit|credit/i.test(cause.message)
}

export function thunderError(err: SuggestionError): SuggestionError {
  const opts = { cause: err.cause ?? err, usage: err.usage && toWriterUsage(err.usage), costKnown: err.costKnown }
  switch (err.kind) {
    case 'auth':
      return new SuggestionError('auth', 'Your Thunder Writer AI key wasn’t accepted. Check it in Settings.', opts)
    case 'permission':
      return isCreditRefusal(err.cause)
        ? new SuggestionError(
            'permission',
            'Thunder Writer AI couldn’t run this request. Your credit may have run out: check your balance in Settings.',
            opts,
          )
        : new SuggestionError('server', 'Thunder Writer AI couldn’t run this request. Try again in a moment.', opts)
    case 'rate_limit':
      return new SuggestionError('rate_limit', 'Thunder Writer AI is busy right now. Suggestions will pause and try again later.', opts)
    case 'network':
      return new SuggestionError('network', 'Could not reach Thunder Writer AI. Check your internet connection.', opts)
    case 'bad_request':
    case 'server':
      return new SuggestionError('server', 'Thunder Writer AI had a problem. Try again in a moment.', opts)
    case 'truncated':
      return new SuggestionError('truncated', 'The AI ran out of room before finishing. Try again.', opts)
    case 'bad_output':
      return new SuggestionError('bad_output', 'The AI returned something unreadable. Try again.', opts)
    default:
      return new SuggestionError(err.kind, err.message, opts)
  }
}

export const thunderProvider: SuggestionProvider = {
  id: 'thunder',

  async generateSuggestions(req: GenerateRequest): Promise<GenerateResult> {
    try {
      const res = await openrouterProvider.generateSuggestions(req)
      return { ...res, usage: toWriterUsage(res.usage) }
    } catch (err) {
      throw err instanceof SuggestionError ? thunderError(err) : err
    }
  },
}
