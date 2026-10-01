/**
 * "Support the developer": the books shown beside Preview Book, one a day.
 * Each is a plain link to Bookshop.org (which shares sales with independent
 * bookstores), so there are no ad scripts, cookies or tracking in the app:
 * nothing happens unless the writer clicks. With VITE_BOOKSHOP_AFFILIATE_ID
 * set at build time the links are affiliate links, and purchases support the
 * developer; without it they are ordinary links. Swap in your own picks here.
 */

export interface BookPick {
  title: string
  author: string
  /** ISBN-13 of the edition linked to. */
  isbn: string
  /** Why a writer might want it, in a few words. */
  blurb: string
}

export const BOOK_PICKS: BookPick[] = [
  { title: 'Bird by Bird', author: 'Anne Lamott', isbn: '9780385480017', blurb: 'On writing and life, one page at a time' },
  { title: 'On Writing', author: 'Stephen King', isbn: '9781439156810', blurb: 'A memoir of the craft' },
  { title: 'Steering the Craft', author: 'Ursula K. Le Guin', isbn: '9780544611610', blurb: 'Exercises in narrative' },
  { title: 'Save the Cat! Writes a Novel', author: 'Jessica Brody', isbn: '9780399579745', blurb: 'Plotting, beat by beat' },
  { title: 'The Elements of Style', author: 'Strunk & White', isbn: '9780205309023', blurb: 'The classic on clear prose' },
]

const affiliateId = () => {
  const v = import.meta.env.VITE_BOOKSHOP_AFFILIATE_ID
  return typeof v === 'string' ? v.trim() : ''
}

/** Bookshop.org: an affiliate link when the build has an affiliate id, else a plain search for the book. */
export function bookUrl(pick: BookPick, id = affiliateId()): string {
  if (/^\d+$/.test(id)) return `https://bookshop.org/a/${id}/${pick.isbn}`
  return `https://bookshop.org/search?keywords=${encodeURIComponent(pick.isbn)}`
}

/** The same pick all day, a different one tomorrow. */
export function pickForDay(now = Date.now(), picks: readonly BookPick[] = BOOK_PICKS): BookPick {
  const day = Math.floor(now / 86_400_000)
  return picks[((day % picks.length) + picks.length) % picks.length]
}
