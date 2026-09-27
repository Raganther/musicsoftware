/**
 * Auditory continuity: a tone interrupted by noise is heard carrying straight
 * through, although it is not there.
 *
 * `veil` hid a melody *under* noise — present in the signal, absent in the ear.
 * This is the mirror: the tone is switched hard off during each burst, so its
 * energy is exactly zero, and the ear supplies it anyway. The only condition is
 * that the noise be loud enough in the tone's own critical band to have masked
 * the tone had it been there. Below that the line audibly pulses; above it the
 * line is continuous and the burst is something laid over the top.
 *
 * The part that is not central at all, and is what this file computes: how much
 * noise actually reaches the tone's critical band. That is an auditory filter
 * of published width — Moore and Glasberg's ERB — and it grows fivefold from a
 * low tone to a high one, so the same noise covers a high note far more easily.
 *
 * And the part that is exactly combinatorial: **a note buried end to end has no
 * evidence on either side and cannot be restored by anything.** Which notes are
 * restorable is a property of the schedule, not of the listener.
 *
 * No imports: run directly under `node --experimental-strip-types`.
 */

/**
 * Equivalent rectangular bandwidth of the auditory filter at `f` Hz —
 * Glasberg & Moore 1990, `24.7·(0.00437·f + 1)`. At 200 Hz it is 46 Hz wide
 * and at 2 kHz it is 241, which is the whole reason a high note is easier to
 * cover than a low one.
 */
export function erb(f: number): number {
  return 24.7 * (0.00437 * f + 1)
}

/** Position on the ERB-rate scale, in filters below `f`. */
export function erbRate(f: number): number {
  return 21.4 * Math.log10(0.00437 * f + 1)
}

/**
 * The rounded-exponential auditory filter, normalised to unit peak. `p` sets
 * how sharply it falls away and is fixed by the ERB, since a roex(p) filter's
 * own equivalent rectangular bandwidth is `4f/p`.
 */
export function roex(f: number, fc: number): number {
  const p = (4 * fc) / erb(fc)
  const g = Math.abs(f - fc) / fc
  return (1 + p * g) * Math.exp(-p * g)
}

/**
 * Power of a flat noise band `[lo, hi]` of spectral density `n0` that gets
 * through the auditory filter centred at `fc`. Trapezium over the band, which
 * is smooth and needs no care.
 */
export function inBand(fc: number, lo: number, hi: number, n0: number, steps = 4096): number {
  if (hi <= lo) return 0
  const h = (hi - lo) / steps
  let s = 0
  for (let i = 0; i <= steps; i++) {
    const f = lo + i * h
    const w = roex(f, fc) * (i === 0 || i === steps ? 0.5 : 1)
    s += w
  }
  return s * h * n0
}

/**
 * The noise power in the critical band, if the band were wide and flat — the
 * quantity Fletcher's band-widening experiment saturates at, and the reference
 * the measured `inBand` should approach as the band grows.
 */
export function criticalPower(fc: number, n0: number): number {
  return erb(fc) * n0
}

/**
 * Amplitude of a tone at the masked threshold: the level at which its power
 * equals the in-band noise power times `k`, the signal-to-noise ratio at
 * threshold. `k = 1` is Fletcher's original assumption.
 */
export function maskedThreshold(fc: number, lo: number, hi: number, n0: number, k = 1): number {
  return Math.sqrt(k * inBand(fc, lo, hi, n0))
}

// -- the schedule -------------------------------------------------------------

export interface Note {
  start: number
  dur: number
  /** MIDI note. */
  pitch: number
}
export interface Burst {
  start: number
  dur: number
}
export type State = 'clear' | 'partial' | 'hidden'

/** Fraction of a note's duration that falls inside some burst. */
export function coverage(note: Note, bursts: Burst[]): number {
  let covered = 0
  const a = note.start
  const b = note.start + note.dur
  for (const t of bursts) {
    const lo = Math.max(a, t.start)
    const hi = Math.min(b, t.start + t.dur)
    if (hi > lo) covered += hi - lo
  }
  return note.dur > 0 ? Math.min(1, covered / note.dur) : 0
}

/**
 * What the ear could possibly do with each note.
 *
 * `hidden` is the interesting one: a note entirely inside a burst leaves no
 * evidence on either side, so there is nothing to continue and no amount of
 * noise will restore it. That is exact, and it is a fact about the schedule.
 */
export function classify(notes: Note[], bursts: Burst[]): State[] {
  return notes.map((n) => {
    const c = coverage(n, bursts)
    return c <= 0 ? 'clear' : c >= 1 ? 'hidden' : 'partial'
  })
}

export interface Tally {
  clear: number
  partial: number
  hidden: number
  /** Fraction of all tone-time that is switched off. */
  absent: number
}

export function tally(notes: Note[], bursts: Burst[]): Tally {
  const st = classify(notes, bursts)
  let total = 0
  let off = 0
  for (const n of notes) {
    total += n.dur
    off += coverage(n, bursts) * n.dur
  }
  return {
    clear: st.filter((s) => s === 'clear').length,
    partial: st.filter((s) => s === 'partial').length,
    hidden: st.filter((s) => s === 'hidden').length,
    absent: total > 0 ? off / total : 0,
  }
}
