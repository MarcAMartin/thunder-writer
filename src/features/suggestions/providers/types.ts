import type { AIProvider, AIUsage } from '../../../types'
import type { RawSuggestionWithSources } from '../sanitize'
import type { RawSuggestion } from '../schema'
import type { TriviaOutcome } from '../trivia'

export interface GenerateRequest {
  apiKey: string
  model: string
  system: string
  /** Stable reference-file block placed behind a cache breakpoint ('' for none). */
  contextBlock: string
  user: string
  maxItems: number
  signal?: AbortSignal
}

export interface GenerateResult {
  items: RawSuggestion[]
  usage: AIUsage
  /** False when the model id has no entry in the pricing table (usage.costUsd is then 0). */
  costKnown: boolean
}

/** The separate web-searched trivia request (tool on, no structured-output constraint). */
export interface TriviaRequest {
  apiKey: string
  model: string
  system: string
  contextBlock: string
  user: string
  signal?: AbortSignal
}

export interface TriviaResult {
  /** One trivia item with its cited sources, or null (see `outcome`). */
  item: RawSuggestionWithSources | null
  outcome: TriviaOutcome
  /** Provider's web search error code when the search itself failed (e.g. too_many_requests). */
  searchErrorCode?: string
  /** Includes the search charges; usage.webSearches counts billed searches. */
  usage: AIUsage
  costKnown: boolean
}

export interface SuggestionProvider {
  id: AIProvider
  generateSuggestions(req: GenerateRequest): Promise<GenerateResult>
  /** Web-searched current-events trivia. Absent when the provider cannot search. */
  generateTrivia?(req: TriviaRequest): Promise<TriviaResult>
  /** Whether `model` can use the provider's web search tool (unknown models: assume yes, detect at runtime). */
  supportsWebSearch?(model: string): boolean
}

export type SuggestionErrorKind =
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'network'
  | 'refusal'
  | 'truncated'
  | 'bad_output'
  | 'bad_request'
  | 'server'
  | 'aborted'
  /** Web search is disabled for the org or unsupported by the model: fall back to plain suggestions. */
  | 'search_unavailable'

/** Provider-neutral error with a message written for the writer, not a developer. */
export class SuggestionError extends Error {
  readonly kind: SuggestionErrorKind
  /** Tokens already billed for a response that was unusable (refusal, truncation). */
  readonly usage?: AIUsage
  readonly costKnown?: boolean
  constructor(
    kind: SuggestionErrorKind,
    message: string,
    options?: { cause?: unknown; usage?: AIUsage; costKnown?: boolean },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'SuggestionError'
    this.kind = kind
    this.usage = options?.usage
    this.costKnown = options?.costKnown
  }
}

export const providerLabel = (p: AIProvider) => (p === 'claude' ? 'Claude' : 'OpenAI')

export function authMessage(p: AIProvider): string {
  return `Your ${providerLabel(p)} API key was rejected. Check it in Settings.`
}

export const CLAUDE_SEARCH_DISABLED_MESSAGE =
  "Web search isn't enabled for your Claude organization — enable it in the Claude Console or turn off web-searched trivia in Settings."

/**
 * True when an API error says the web search tool itself is unavailable (org
 * setting, model support), as opposed to any other bad request.
 */
export function isWebSearchUnavailableMessage(message: string): boolean {
  return (
    /web[\s_-]?search/i.test(message) &&
    /(not (been )?enabled|isn'?t enabled|disabled|not available|unavailable|not supported|unsupported|does not support|doesn'?t support|not allowed|not permitted)/i.test(
      message,
    )
  )
}

export function isOrgDisabledMessage(message: string): boolean {
  return /(not (been )?enabled|isn'?t enabled|disabled)/i.test(message)
}
