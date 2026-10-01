/**
 * Typewriter sounds (Toolbar › Typewriter sounds), made with the Web Audio API
 * rather than recordings, so there is nothing to download or license. The
 * voice is a clicky mechanical keyboard (blue switches, with a nod to the IBM
 * Model M's buckling spring), built in layers so it sounds full rather than flat:
 *
 *   press    the click jacket's sharp, bright snap; a moment later the key
 *            bottoming out (a plastic "clack" with the case resonating under
 *            it); and a faint metallic ring from the spring
 *   release  a second, quieter click on the way up, as blue switches give
 *   delete   Backspace and Delete: a lower, hollower clack, like a wide key
 *            with a stabilizer, with its faint rattle
 *
 * All of it runs through a short "room" (a generated impulse response) and a
 * gentle compressor. Each stroke varies a little, so fast typing never sounds
 * like a loop, and the space bar and Enter strike deeper.
 */

type AudioContextCtor = typeof AudioContext

interface Rig {
  c: AudioContext
  /** Dry path to the speakers (through the compressor). */
  dry: GainNode
  /** Into the short room reverb. */
  wet: GainNode
  noise: AudioBuffer
}

let rig: Rig | null = null

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** A small room: 90 ms of noise falling away quickly, darker at the end. */
function roomImpulse(c: AudioContext): AudioBuffer {
  const length = Math.ceil(c.sampleRate * 0.09)
  const ir = c.createBuffer(2, length, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    let low = 0
    for (let i = 0; i < length; i++) {
      const fall = Math.pow(1 - i / length, 3.2)
      // A one-pole low-pass that closes as the tail fades, so the room sounds soft, not hissy.
      const k = 0.55 + 0.4 * (i / length)
      low = low * k + (Math.random() * 2 - 1) * (1 - k)
      d[i] = low * fall
    }
  }
  return ir
}

/** Lazily, from the first key press (browsers only start audio after a user gesture). */
function audio(): Rig | null {
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  if (!rig) {
    let c: AudioContext
    try {
      c = new Ctor()
    } catch {
      return null
    }
    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 12
    comp.ratio.value = 3
    comp.attack.value = 0.002
    comp.release.value = 0.08
    const out = c.createGain()
    out.gain.value = 0.7
    comp.connect(out).connect(c.destination)

    const dry = c.createGain()
    dry.gain.value = 1
    dry.connect(comp)
    const room = c.createConvolver()
    room.buffer = roomImpulse(c)
    const wet = c.createGain()
    wet.gain.value = 0.22
    wet.connect(room).connect(comp)

    // A fifth of a second of white noise, the raw material of every click.
    const noise = c.createBuffer(1, Math.ceil(c.sampleRate * 0.2), c.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    rig = { c, dry, wet, noise }
  }
  if (rig.c.state === 'suspended') void rig.c.resume().catch(() => undefined)
  return rig
}

const vary = (value: number, by: number) => value * (1 + (Math.random() * 2 - 1) * by)

/** Sends a voice to both the dry path and the room. */
function toOutputs(r: Rig, node: AudioNode, wet = 1) {
  node.connect(r.dry)
  if (wet > 0) {
    const send = r.c.createGain()
    send.gain.value = wet
    node.connect(send).connect(r.wet)
  }
}

/** Filtered noise with a near-instant attack and an exponential fall. */
function noiseHit(
  r: Rig,
  at: number,
  o: { filters: { type: BiquadFilterType; freq: number; q?: number; gain?: number }[]; peak: number; decay: number; wet?: number },
) {
  const src = r.c.createBufferSource()
  src.buffer = r.noise
  let node: AudioNode = src
  for (const f of o.filters) {
    const bq = r.c.createBiquadFilter()
    bq.type = f.type
    bq.frequency.value = f.freq
    if (f.q !== undefined) bq.Q.value = f.q
    if (f.gain !== undefined) bq.gain.value = f.gain
    node.connect(bq)
    node = bq
  }
  const g = r.c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(o.peak, at + 0.0008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.decay)
  node.connect(g)
  toOutputs(r, g, o.wet ?? 1)
  src.start(at, Math.random() * 0.15)
  src.stop(at + o.decay + 0.02)
}

/** A short tone, optionally sliding in pitch: a key's body, or the spring's ring. */
function tone(
  r: Rig,
  at: number,
  o: { type: OscillatorType; from: number; to?: number; peak: number; decay: number; attack?: number; wet?: number },
) {
  const osc = r.c.createOscillator()
  osc.type = o.type
  osc.frequency.setValueAtTime(o.from, at)
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.decay)
  const g = r.c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(o.peak, at + (o.attack ?? 0.0015))
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.decay)
  osc.connect(g)
  toOutputs(r, g, o.wet ?? 1)
  osc.start(at)
  osc.stop(at + o.decay + 0.02)
}

/** The click jacket: a 4–6 ms bright snap. */
function snap(r: Rig, at: number, level: number, pitch = 1) {
  noiseHit(r, at, {
    filters: [
      { type: 'highpass', freq: 2600 * pitch, q: 0.7 },
      { type: 'peaking', freq: vary(5200, 0.08) * pitch, q: 2.2, gain: 9 },
    ],
    peak: vary(level, 0.12),
    decay: vary(0.006, 0.2),
    wet: 0.6,
  })
}

/** The keycap bottoming out on the plate: a plastic clack with the case's body under it. */
function clack(r: Rig, at: number, o: { body: number; level: number; length: number; bright?: number }) {
  noiseHit(r, at, {
    filters: [
      { type: 'bandpass', freq: vary(o.body * 3.4, 0.08), q: 1.4 },
      { type: 'lowshelf', freq: 400, gain: 6 },
    ],
    peak: vary(o.level, 0.12),
    decay: vary(o.length, 0.12),
  })
  // The case resonating: a low, quickly falling tone gives the "thock" weight.
  tone(r, at, { type: 'triangle', from: vary(o.body, 0.05), to: o.body * 0.72, peak: vary(o.level * 0.55, 0.15), decay: o.length * 1.4 })
  // A little top end, so it reads as plastic rather than a thud.
  noiseHit(r, at + 0.0005, {
    filters: [{ type: 'bandpass', freq: vary(2400 * (o.bright ?? 1), 0.1), q: 3 }],
    peak: vary(o.level * 0.35, 0.2),
    decay: 0.012,
    wet: 0.5,
  })
}

/** The spring's faint metallic ring (the Model M's buckling spring). */
function ring(r: Rig, at: number, level: number) {
  const f = vary(3150, 0.06)
  tone(r, at, { type: 'sine', from: f, peak: level, decay: vary(0.09, 0.15), attack: 0.002, wet: 1.4 })
  tone(r, at, { type: 'sine', from: f * 1.53, peak: level * 0.45, decay: 0.05, attack: 0.002, wet: 1.4 })
}

/** A wide key's stabilizer: two or three tiny ticks just after the clack. */
function rattle(r: Rig, at: number, level: number) {
  for (let i = 0, t = at + vary(0.011, 0.2); i < 3; i++, t += vary(0.008, 0.3)) {
    noiseHit(r, t, { filters: [{ type: 'bandpass', freq: vary(1900, 0.15), q: 4 }], peak: level * (1 - i * 0.3), decay: 0.006, wet: 0.8 })
  }
}

export type KeySize = 'key' | 'wide'

/** A character typed. `wide` (space bar, Enter) strikes deeper and heavier. */
export function playStrike(size: KeySize = 'key'): void {
  const r = audio()
  if (!r) return
  const t = r.c.currentTime + 0.002
  const wide = size === 'wide'
  snap(r, t, wide ? 0.55 : 0.75)
  // The clack lands a few milliseconds after the click, as the key travels on to the plate.
  const down = t + vary(0.007, 0.25)
  clack(r, down, wide ? { body: 155, level: 0.95, length: 0.055, bright: 0.8 } : { body: vary(235, 0.06), level: 0.8, length: 0.038 })
  ring(r, down + 0.001, wide ? 0.03 : 0.04)
  if (wide) rattle(r, down, 0.12)
}

/** The key coming back up: a second, quieter click and a light top-out. */
export function playRelease(size: KeySize = 'key'): void {
  const r = audio()
  if (!r) return
  const t = r.c.currentTime + 0.002
  snap(r, t, size === 'wide' ? 0.28 : 0.4, 1.08)
  clack(r, t + 0.003, { body: size === 'wide' ? 210 : 330, level: 0.22, length: 0.018, bright: 1.2 })
}

/** Backspace or Delete: a lower, hollower clack with a stabilizer's rattle, unmistakably not a letter. */
export function playDelete(): void {
  const r = audio()
  if (!r) return
  const t = r.c.currentTime + 0.002
  snap(r, t, 0.5, 0.78)
  const down = t + vary(0.009, 0.2)
  clack(r, down, { body: vary(128, 0.05), level: 1, length: 0.07, bright: 0.6 })
  rattle(r, down, 0.16)
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

/** The space bar and Enter are wide keys, with a deeper stroke. */
export const keySize = (key: string): KeySize => (key === ' ' || key === 'Enter' ? 'wide' : 'key')

/** Fast typing and key repeat still get a sound for each key, but never more than one every 18 ms. */
export const MIN_GAP_MS = 18
