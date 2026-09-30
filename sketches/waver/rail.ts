/**
 * A pitch rail that corrects in time rather than in strength, and the one thing
 * that buys.
 *
 * `guardrail` (2026-09-04) measured the safety/expression trade along the
 * rail's *strength*: from no help to full help the vocabulary falls from 61 to
 * 8 distinguishable notes an octave while the in-tune fraction goes 13% → 100%.
 * A strong rail is in tune and says nothing. That axis cannot separate
 * expression from error, because it cannot tell a wobble from being flat —
 * both are just distance from a degree.
 *
 * They differ in **frequency**, not in size. Being flat is a slow thing;
 * vibrato is a fast one. So smooth the *correction* rather than weakening it:
 *
 *     err = snap(input) − input        how far off the note
 *     c  += a·(err − c)                the correction, lagged
 *     out = input + strength·c
 *
 * What survives is `|1 − H_lp|`, a one-pole high-pass on the pitch error — so a
 * 6 Hz vibrato passes and a 0.2 Hz drift is pulled out, with one knob.
 *
 * That is exact only while the wobble stays inside one degree. Cross a snap
 * boundary and `snap(input)` jumps, the system stops being linear at all, and
 * what comes out is the warble everyone can name.
 *
 * No imports: run directly under `node --experimental-strip-types`.
 */

/** Control rate of the rail, in Hz. The sketch schedules pitch at this rate. */
export const CONTROL_HZ = 400

/** One-pole coefficient for a time constant of `tau` seconds. */
export function coeff(tau: number, fs = CONTROL_HZ): number {
  if (tau <= 0) return 1
  return 1 - Math.exp(-1 / (tau * fs))
}

/**
 * Fraction of a pitch modulation at `f` Hz that survives the rail, for the
 * exact discrete one-pole — `|1 − H_lp|`, evaluated on the unit circle.
 *
 * The continuous approximation `ωτ/√(1+(ωτ)²)` is close but not equal, and
 * using it would invent a discrepancy at high rates that is entirely the
 * sample rate.
 */
export function survives(a: number, f: number, fs = CONTROL_HZ): number {
  const w = (2 * Math.PI * f) / fs
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  // H_hp = (1−a)(1 − z⁻¹) / (1 − (1−a)z⁻¹)
  const g = 1 - a
  const numRe = g * (1 - cw)
  const numIm = g * sw
  const denRe = 1 - g * cw
  const denIm = g * sw
  return Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm)
}

/** Nearest allowed pitch, in semitones, given the scale's pitch classes. */
export function snap(pitch: number, classes: number[]): number {
  if (!classes.length) return pitch
  let best = pitch
  let dist = Infinity
  const base = Math.floor(pitch / 12) * 12
  for (let oct = -1; oct <= 1; oct++) {
    for (const c of classes) {
      const p = base + oct * 12 + c
      const d = Math.abs(p - pitch)
      if (d < dist) {
        dist = d
        best = p
      }
    }
  }
  return best
}

/** The spacing between allowed pitches, in semitones — the size of a snap step. */
export function spacing(classes: number[]): number {
  if (classes.length < 2) return 12
  const s = [...classes].sort((a, b) => a - b)
  let worst = Infinity
  for (let i = 0; i < s.length; i++) {
    const d = i + 1 < s.length ? s[i + 1] - s[i] : s[0] + 12 - s[i]
    if (d < worst) worst = d
  }
  return worst
}

export interface RailState {
  c: number
}

export function railStep(st: RailState, input: number, a: number, strength: number, classes: number[]): number {
  const err = snap(input, classes) - input
  st.c += a * (err - st.c)
  return input + strength * st.c
}

/** Run a whole pitch trajectory through the rail. */
export function railRun(input: Float64Array, a: number, strength: number, classes: number[]): Float64Array {
  const st: RailState = { c: 0 }
  const out = new Float64Array(input.length)
  for (let i = 0; i < input.length; i++) out[i] = railStep(st, input[i], a, strength, classes)
  return out
}

/**
 * Amplitude of a signal's component at `f` Hz, by projection. The pitch track
 * is not a sine once the rail goes nonlinear, so this reads the *fundamental*
 * of the wobble and leaves the warble to `distortion`.
 */
export function component(x: Float64Array, f: number, fs = CONTROL_HZ, skip = 0): number {
  let re = 0
  let im = 0
  const n = x.length - skip
  if (n < 8) return 0
  let mean = 0
  for (let i = skip; i < x.length; i++) mean += x[i]
  mean /= n
  for (let i = skip; i < x.length; i++) {
    const w = (2 * Math.PI * f * (i - skip)) / fs
    re += (x[i] - mean) * Math.cos(w)
    im += (x[i] - mean) * Math.sin(w)
  }
  return (2 * Math.hypot(re, im)) / n
}

/**
 * How much of the wobble is *not* at the wobble's own rate: the energy outside
 * the fundamental, as a fraction of the total. Zero while the rail is linear,
 * and the warble when it is not.
 */
export function distortion(x: Float64Array, f: number, fs = CONTROL_HZ, skip = 0): number {
  const n = x.length - skip
  if (n < 8) return 0
  let mean = 0
  for (let i = skip; i < x.length; i++) mean += x[i]
  mean /= n
  let total = 0
  for (let i = skip; i < x.length; i++) total += (x[i] - mean) * (x[i] - mean)
  total /= n
  const f0 = component(x, f, fs, skip)
  const inFund = (f0 * f0) / 2
  return total > 1e-18 ? Math.max(0, 1 - inFund / total) : 0
}

/** Fraction of the time the output sits within `tol` semitones of an allowed pitch. */
export function inTune(x: Float64Array, classes: number[], tol = 0.25, skip = 0): number {
  let ok = 0
  let n = 0
  for (let i = skip; i < x.length; i++) {
    n++
    if (Math.abs(snap(x[i], classes) - x[i]) <= tol) ok++
  }
  return n ? ok / n : 0
}

export interface Player {
  /** Centre pitch, in semitones. */
  base: number
  /** Vibrato depth in semitones (peak). */
  depth: number
  /** Vibrato rate in Hz. */
  rate: number
  /** Slow error the rail is supposed to remove, in semitones. */
  drift: number
  /** Rate of that slow error, in Hz. */
  driftRate: number
}

/** A played line: a centre, a wobble, and a slow mistuning underneath it. */
export function play(p: Player, seconds: number, fs = CONTROL_HZ): Float64Array {
  const n = Math.round(seconds * fs)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / fs
    out[i] =
      p.base + p.depth * Math.sin(2 * Math.PI * p.rate * t) + p.drift * Math.sin(2 * Math.PI * p.driftRate * t)
  }
  return out
}
