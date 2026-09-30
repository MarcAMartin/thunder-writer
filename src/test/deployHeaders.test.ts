import { describe, expect, it } from 'vitest'
import raw from '../../vercel.json?raw'

interface VercelConfig {
  rewrites?: { source: string; destination: string }[]
  headers?: { source: string; headers: { key: string; value: string }[] }[]
}

describe('vercel.json', () => {
  const config = JSON.parse(raw) as VercelConfig
  const all = config.headers?.find((h) => h.source === '/(.*)')?.headers ?? []
  const header = (key: string) => all.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value

  it('forbids framing the app on other sites (clickjacking of Connect Drive, Save, Import…)', () => {
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })

  it('sets nosniff and a referrer policy that still lets the Picker key’s website restriction see the origin', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('keeps the SPA fallback for deep links', () => {
    expect(config.rewrites?.[0]).toMatchObject({ destination: '/index.html' })
  })
})
