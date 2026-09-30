import type { SuggestionKind, SuggestionStatus } from '../../types'

export const KIND_LABEL: Record<SuggestionKind, string> = {
  grammar: 'Grammar',
  spelling: 'Spelling',
  style: 'Style',
  context: 'Context',
  general: 'Idea',
  trivia: 'Trivia',
}

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  declined: 'Declined',
  done: 'Done',
  hidden: 'Hidden',
}
