import { chapterTitleOf, docBlocks, headingLevel } from '../export/pm'

/** Chapter titles of a stored document, as the Book preview and the exporters read them. */
export function chapterTitlesOf(content: unknown): string[] {
  return docBlocks(content)
    .filter((b) => b.type === 'heading' && headingLevel(b) === 1)
    .map(chapterTitleOf)
    .filter(Boolean)
}
