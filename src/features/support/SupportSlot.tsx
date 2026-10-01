import { useState } from 'react'
import { useSettings } from '../../store/settings'
import { Modal } from '../storage/Modal'
import { bookUrl, pickForDay } from './bookPicks'
import './support.css'

/**
 * Beside Preview Book. Off (the default): a small "Support the developer"
 * button. On: a book pick, marked as an ad, with a way to turn it off that
 * first asks the writer to reconsider. The choice is saved in Settings.
 */
export function SupportSlot() {
  const on = useSettings((s) => s.supportDeveloper)
  const set = useSettings((s) => s.set)
  const [asking, setAsking] = useState(false)
  const pick = pickForDay()

  if (!on) {
    return (
      <button
        type="button"
        className="ed-tool ed-tool-text su-offer"
        title="Show a book pick here. It keeps Thunder Writer free, and you can turn it off any time."
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => set({ supportDeveloper: true })}
      >
        <span aria-hidden="true">♥</span> Support the developer
      </button>
    )
  }

  return (
    <>
      <span className="su-ad" role="group" aria-label="Book pick (ad). Supports the developer">
        <span className="su-ad-tag" aria-hidden="true">
          Ad
        </span>
        <a className="su-ad-link" href={bookUrl(pick)} target="_blank" rel="sponsored noopener noreferrer" title={`${pick.blurb}. Opens Bookshop.org in a new tab`}>
          <span className="su-ad-title">{pick.title}</span>
          <span className="su-ad-author">, {pick.author}</span>
          <span className="su-ad-out" aria-hidden="true">
            ↗
          </span>
          <span className="ed-sr"> (opens Bookshop.org in a new tab)</span>
        </a>
        <button
          type="button"
          className="su-ad-off"
          aria-label="Turn off book picks"
          title="Turn off book picks"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAsking(true)}
        >
          ✕
        </button>
      </span>
      {asking && (
        <Modal
          title="Please reconsider"
          onClose={() => setAsking(false)}
          footer={
            <>
              <button
                type="button"
                className="tw-btn"
                onClick={() => {
                  set({ supportDeveloper: false })
                  setAsking(false)
                }}
              >
                Turn off
              </button>
              <button type="button" className="tw-btn tw-btn-primary" data-autofocus onClick={() => setAsking(false)}>
                Keep supporting
              </button>
            </>
          }
        >
          <p className="su-ask">
            This one quiet book pick is how Thunder Writer stays free. It’s a plain link: nothing tracks you, and it only
            does anything if you click it. Keep supporting the developer?
          </p>
        </Modal>
      )}
    </>
  )
}
