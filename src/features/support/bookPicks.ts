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
  /** What the book is, in a few words. */
  blurb: string
}

/**
 * The New York Times hardcover best sellers, list dated October 18, 2026:
 * fiction 1–12, then nonfiction 1–8, with the ISBN-13 the list gives for each
 * edition. Refresh from a newer list now and then.
 */
export const BOOK_PICKS: BookPick[] = [
  { title: 'Threshing Day', author: 'Rebecca Yarros', isbn: '9781682818084', blurb: 'Thirteen Empyrean stories of riders and dragons' },
  { title: 'The French Illusion', author: 'John Grisham', isbn: '9780385550543', blurb: 'A kidnapped honeymoon and a CIA gambit' },
  { title: 'Hollywood, Ending', author: 'John Green', isbn: '9780525426073', blurb: 'Two rising actors, one Warhol biopic' },
  { title: 'American Hagwon', author: 'Min Jin Lee', isbn: '9781538752036', blurb: 'A Korean family’s journey from Seoul to California' },
  { title: 'The Calamity Club', author: 'Kathryn Stockett', isbn: '9781954118812', blurb: 'Women banding together in Depression-era Mississippi' },
  { title: 'Hollow Bones', author: 'Jodi Picoult', isbn: '9780593726259', blurb: 'A new marriage shaken by old secrets' },
  { title: 'Baldur’s Gate 3: Astarion', author: 'T. Kingfisher', isbn: '9798217298594', blurb: 'A vampire spawn’s bid for freedom' },
  { title: 'The Dawn of the Cursed Queen', author: 'Amber V. Nicole', isbn: '9781496758088', blurb: 'Gods, monsters, and a queen’s sacrifice' },
  { title: 'Heated Rivalry', author: 'Rachel Reid', isbn: '9781335004048', blurb: 'Rival hockey captains in a secret romance' },
  { title: 'Sometimes I Scare Myself', author: 'Jeneva Rose', isbn: '9798212182881', blurb: 'Three horror stories, one curse at a time' },
  { title: 'Ruthless', author: 'Danielle Steel', isbn: '9780593973301', blurb: 'A journalist and a tycoon in St. Barts' },
  { title: 'Yesteryear', author: 'Caro Claire Burke', isbn: '9780593804216', blurb: 'A tradwife influencer wakes up in 1855' },
  { title: 'The Steps', author: 'Sylvester Stallone', isbn: '9780063443914', blurb: 'Stallone’s road from New York to Rocky' },
  { title: 'Swan Song', author: 'Charles Spencer', isbn: '9798217379743', blurb: 'A brother’s memoir of Diana' },
  { title: 'The American Way of Killing', author: 'Malcolm Gladwell', isbn: '9780316603782', blurb: 'Inside America’s epidemic of gun violence' },
  { title: 'What Could Possibly Go Right?', author: 'Danny Meyer', isbn: '9780593731772', blurb: 'Scaling a culture of hospitality' },
  { title: 'Fictional Selves', author: 'Kyle MacLachlan', isbn: '9798217086320', blurb: 'An actor’s life through his characters' },
  { title: 'The Cauldron', author: 'Simon Sebag Montefiore', isbn: '9780593805053', blurb: 'How the modern Middle East was made' },
  { title: 'This Cursed Beautiful Land', author: 'Evan Gershkovich', isbn: '9798217087266', blurb: 'A journalist imprisoned in Putin’s Russia' },
  { title: 'Work in Progress', author: 'Devon Rodriguez', isbn: '9780593734483', blurb: 'A Bronx portrait artist’s memoir' },
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
