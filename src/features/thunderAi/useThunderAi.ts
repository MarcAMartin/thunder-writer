import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSettings } from '../../store/settings'
import { formatThunderAiKey, parseThunderAiKey } from './key'
import { CHECKOUT_RETURN_PARAM, isCheckoutSessionId } from './plans'
import {
  claimPurchase,
  fetchBalance,
  forgetPending,
  pendingPurchases,
  rememberPending,
  RETRY_LATER,
  ThunderAiError,
  type Balance,
} from './purchases'

export interface PurchaseNotice {
  tone: 'ok' | 'info' | 'error'
  text: string
}

const formatUsd = (usd: number) => `$${usd.toFixed(2)}`

/** One claim at a time across this browser's tabs, so two tabs can't credit the same purchase twice. */
function withClaimLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request('thunder-writer:ai-claim', run) : run()
}

/**
 * Credits Thunder Writer AI purchases when Settings opens: the one Stripe just
 * sent the writer back with (?ai_checkout=…) and any still remembered from
 * before. A credited purchase stores the key and makes Thunder Writer AI the
 * provider. Returns a notice about the purchase the writer just made.
 */
export function useThunderAiPurchases(onCredited: () => void): PurchaseNotice | null {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<PurchaseNotice | null>(null)
  const started = useRef(false)
  const credited = useRef(onCredited)
  credited.current = onCredited

  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(location.search)
    const returned = params.get(CHECKOUT_RETURN_PARAM)
    if (returned !== null) {
      params.delete(CHECKOUT_RETURN_PARAM)
      const search = params.toString()
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: '#thunder-ai' }, { replace: true })
    }
    const fromStripe = isCheckoutSessionId(returned) ? returned : null
    if (fromStripe) {
      rememberPending(fromStripe)
      setNotice({ tone: 'info', text: 'Adding your Thunder Writer AI credit…' })
    }

    void (async () => {
      for (const id of pendingPurchases()) {
        const shown = id === fromStripe
        const result = await withClaimLock(() => claimOnce(id))
        if (result.ok) credited.current()
        if (shown || (result.ok && result.notice.tone === 'ok')) setNotice(result.notice)
      }
    })()
    // Runs once, when Settings opens.
  }, [])

  return notice
}

type ClaimOutcome = { ok: true; notice: PurchaseNotice } | { ok: false; notice: PurchaseNotice }

async function claimOnce(id: string, retried = false): Promise<ClaimOutcome> {
  const settings = useSettings.getState()
  const held = parseThunderAiKey(settings.thunderAiKey)
  try {
    const res = await claimPurchase(id, held?.hash)
    forgetPending(id)
    if (res.key) settings.set({ thunderAiKey: formatThunderAiKey({ hash: res.hash, key: res.key }), provider: 'thunder' })
    else if (res.credited > 0) settings.set({ provider: 'thunder' })
    const text =
      res.credited > 0
        ? `Added ${formatUsd(res.credited)} of Thunder Writer AI credit. Suggestions now use Thunder Writer AI.`
        : res.key
          ? 'Your Thunder Writer AI key is back in this browser.'
          : 'That purchase is already in your balance.'
    return { ok: true, notice: { tone: res.credited > 0 || res.key ? 'ok' : 'info', text } }
  } catch (e) {
    const err = e instanceof ThunderAiError ? e : new ThunderAiError('upstream', 'Thunder Writer AI couldn’t add your credit.')
    if (err.code === 'busy' && !retried) {
      await new Promise((r) => setTimeout(r, 3_000))
      return claimOnce(id, true)
    }
    if (RETRY_LATER.has(err.code)) {
      const text =
        err.code === 'not_paid' ? err.message : `${err.message} Your payment is safe: Settings tries again the next time it opens.`
      return { ok: false, notice: { tone: err.code === 'not_paid' ? 'info' : 'error', text } }
    }
    forgetPending(id)
    return { ok: false, notice: { tone: 'error', text: err.message } }
  }
}

export type BalanceState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; balance: Balance }
  | { status: 'rejected' }
  | { status: 'failed' }

/** The balance on the stored Thunder Writer AI key, with a refresh. */
export function useThunderAiBalance(openRouterKey: string | null): { state: BalanceState; refresh: () => void } {
  const [state, setState] = useState<BalanceState>({ status: 'idle' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!openRouterKey) {
      setState({ status: 'idle' })
      return
    }
    let live = true
    setState({ status: 'loading' })
    fetchBalance(openRouterKey)
      .then((balance) => live && setState(balance ? { status: 'ready', balance } : { status: 'rejected' }))
      .catch(() => live && setState({ status: 'failed' }))
    return () => {
      live = false
    }
  }, [openRouterKey, tick])
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return { state, refresh }
}
