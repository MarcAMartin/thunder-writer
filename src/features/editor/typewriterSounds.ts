/**
 * Typewriter sounds (Toolbar › Typewriter sounds), made with the Web Audio API
 * rather than recordings, so there is nothing to download or license. Two
 * sounds: a bright strike for each character typed (the typebar on the
 * platen, with the key's thump under it) and a duller double knock for
 * Backspace and Delete. Each strike varies a little, so fast typing doesn't
 * sound like a loop.
 */

type AudioContextCtor = typeof AudioContext

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let master: GainNode | null = null

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** Lazily, from the first key press (browsers only start audio after a user gesture). */
function audio(): { c: AudioContext; out: GainNode; buffer: AudioBuffer } | null {
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  if (!ctx) {
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
    master = ctx.createGain()
    master.gain.value = 0.32
    master.connect(ctx.destination)
    // A fifth of a second of white noise, the raw material of every click.
    noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.2), ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  return { c: ctx, out: master!, buffer: noise! }
}

const vary = (value: number, by: number) => value * (1 + (Math.random() * 2 - 1) * by)

/** A burst of filtered noise with a fast attack and an exponential fall. */
function click(
  a: { c: AudioContext; out: GainNode; buffer: AudioBuffer },
  at: number,
  opts: { type: BiquadFilterType; freq: number; q: number; gain: number; decay: number },
) {
  const src = a.c.createBufferSource()
  src.buffer = a.buffer
  const filter = a.c.createBiquadFilter()
  filter.type = opts.type
  filter.frequency.value = opts.freq
  filter.Q.value = opts.q
  const g = a.c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(opts.gain, at + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay)
  src.connect(filter).connect(g).connect(a.out)
  src.start(at, Math.random() * 0.12)
  src.stop(at + opts.decay + 0.02)
}

/** A short tone sliding down: the body of a key or the carriage. */
function thump(a: { c: AudioContext; out: GainNode }, at: number, opts: { from: number; to: number; gain: number; decay: number }) {
  const o = a.c.createOscillator()
  o.type = 'triangle'
  o.frequency.setValueAtTime(opts.from, at)
  o.frequency.exponentialRampToValueAtTime(opts.to, at + opts.decay)
  const g = a.c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(opts.gain, at + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay)
  o.connect(g).connect(a.out)
  o.start(at)
  o.stop(at + opts.decay + 0.02)
}

/** A character typed: the typebar's bright strike, with the key's thump under it. */
export function playStrike(): void {
  const a = audio()
  if (!a) return
  const t = a.c.currentTime
  click(a, t, { type: 'bandpass', freq: vary(2600, 0.15), q: 1.1, gain: vary(0.9, 0.2), decay: vary(0.045, 0.2) })
  thump(a, t, { from: vary(190, 0.1), to: 70, gain: vary(0.35, 0.2), decay: 0.06 })
}

/** Backspace or Delete: a duller, lower double knock, like the carriage stepping back. */
export function playDelete(): void {
  const a = audio()
  if (!a) return
  const t = a.c.currentTime
  click(a, t, { type: 'lowpass', freq: vary(1100, 0.1), q: 0.8, gain: vary(0.7, 0.15), decay: 0.05 })
  click(a, t + 0.034, { type: 'lowpass', freq: vary(800, 0.1), q: 0.8, gain: vary(0.45, 0.15), decay: 0.06 })
  thump(a, t, { from: 120, to: 55, gain: 0.3, decay: 0.09 })
}

export type TypewriterSound = 'strike' | 'delete' | null

/** Which sound a key press makes in the editor, if any. */
export function soundForKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>): TypewriterSound {
  if (e.isComposing || e.ctrlKey || e.metaKey) return null
  if (e.key === 'Backspace' || e.key === 'Delete') return 'delete'
  if (e.key === 'Enter' || e.key === 'Tab') return 'strike'
  // A printable character (Alt combinations type characters on a Mac).
  return e.key.length === 1 ? 'strike' : null
}

/** Fast typing and key repeat still get a sound for each key, but never more than one every 18 ms. */
export const MIN_GAP_MS = 18
