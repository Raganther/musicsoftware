/**
 * Two melodies, cut up between the ears, and the ones you actually hear.
 *
 * Diana Deutsch's scale illusion, 1975: send an ascending scale and a
 * descending one, alternating which ear gets which note, and nobody hears
 * what was sent. Each ear physically receives a jagged sequence leaping
 * about; what people report is a smooth high line on one side and a smooth
 * low line on the other. Hearing groups by *pitch proximity* before it groups
 * by ear.
 *
 * Every other illusion in this repo is a fact about the signal — `tartini`'s
 * difference tones are in the wire at −164 dB and come up 120 dB through a
 * nonlinearity, and that can be measured. This one is central, so there is
 * nothing in the wire to point at. What *can* be measured exactly is the
 * combinatorics: regrouping by proximity is a two-state assignment problem
 * with an exact optimum, so "what you would hear if you grouped by proximity"
 * is computable and can be compared, note for note, with what was composed and
 * with what each ear received.
 *
 * That turns an illusion into a composition tool with a number on it: write
 * two lines, scatter them, and ask how far the scattering has moved each ear
 * from the music without moving the music.
 *
 * By relative path, not `@core`: the harness imports this module directly in
 * node, and node cannot resolve a Vite alias.
 */
import { rng } from '../../src/core/random.ts'

/** Which line is sent to the left ear at each step. */
export type Side = 0 | 1

export interface Piece {
  /** The two composed lines, in scale degrees. */
  lines: [number[], number[]]
  /** side[t] = which line went to the left ear at step t. */
  side: Side[]
}

export type Scatter = 'alternate' | 'random' | 'none'

/** What each ear physically receives. */
export function ears(p: Piece): [number[], number[]] {
  const n = p.side.length
  const left: number[] = []
  const right: number[] = []
  for (let t = 0; t < n; t++) {
    left.push(p.lines[p.side[t]][t])
    right.push(p.lines[1 - p.side[t]][t])
  }
  return [left, right]
}

/** The simplest grouping rule: the higher note each instant joins the high stream. */
export function byHeight(p: Piece): [number[], number[]] {
  const [l, r] = ears(p)
  const hi: number[] = []
  const lo: number[] = []
  for (let t = 0; t < l.length; t++) {
    hi.push(Math.max(l[t], r[t]))
    lo.push(Math.min(l[t], r[t]))
  }
  return [hi, lo]
}

/**
 * The two streams that move least overall.
 *
 * At each step there are two notes and two ways to hand them to the streams,
 * so the whole regrouping is a two-state Viterbi over the sequence and the
 * optimum is exact. This is the strong form of "group by proximity": unlike
 * the by-height rule it is allowed to let the streams cross if crossing costs
 * less than jumping.
 */
export function minMotion(p: Piece): { streams: [number[], number[]]; cost: number } {
  const [l, r] = ears(p)
  const n = l.length
  if (!n) return { streams: [[], []], cost: 0 }
  // state 0: stream A took the left note; state 1: stream A took the right note
  const best = [0, 0]
  const back: number[][] = [[], []]
  for (let t = 1; t < n; t++) {
    const prevA = [l[t - 1], r[t - 1]]
    const curA = [l[t], r[t]]
    const next = [Infinity, Infinity]
    const bk = [0, 0]
    for (let s = 0; s < 2; s++) {
      for (let q = 0; q < 2; q++) {
        const move = Math.abs(curA[s] - prevA[q]) + Math.abs(curA[1 - s] - prevA[1 - q])
        const c = best[q] + move
        if (c < next[s]) {
          next[s] = c
          bk[s] = q
        }
      }
    }
    best[0] = next[0]
    best[1] = next[1]
    back[0].push(bk[0])
    back[1].push(bk[1])
  }
  let s = best[0] <= best[1] ? 0 : 1
  const states = new Array<number>(n)
  states[n - 1] = s
  for (let t = n - 1; t > 0; t--) {
    s = back[s][t - 1]
    states[t - 1] = s
  }
  const A: number[] = []
  const B: number[] = []
  for (let t = 0; t < n; t++) {
    A.push(states[t] === 0 ? l[t] : r[t])
    B.push(states[t] === 0 ? r[t] : l[t])
  }
  return { streams: [A, B], cost: Math.min(best[0], best[1]) }
}

/** Mean absolute step, in scale degrees — how much a line leaps about. */
export function jaggedness(seq: number[]): number {
  if (seq.length < 2) return 0
  let s = 0
  for (let i = 1; i < seq.length; i++) s += Math.abs(seq[i] - seq[i - 1])
  return s / (seq.length - 1)
}

/**
 * How well a pair of streams matches a pair of lines, allowing either pairing.
 * Unordered, because "which stream is which" is not part of the claim.
 */
export function matches(got: [number[], number[]], want: [number[], number[]]): number {
  const n = want[0].length
  let same = 0
  let swapped = 0
  for (let t = 0; t < n; t++) {
    if (got[0][t] === want[0][t] && got[1][t] === want[1][t]) same++
    if (got[0][t] === want[1][t] && got[1][t] === want[0][t]) swapped++
  }
  return Math.max(same, swapped) / n
}

/**
 * Steps where the two composed lines swap which is higher.
 *
 * A crossing through a *touch* — both lines on the same degree for a step or
 * more — counts, which the obvious version misses by skipping zeros. That
 * matters here because the classic scale pair meets in the middle rather than
 * passing through, and skipping it reported pieces as crossing-free that were
 * not.
 */
export function crossings(lines: [number[], number[]]): number {
  let k = 0
  let last = 0
  for (let t = 0; t < lines[0].length; t++) {
    const s = Math.sign(lines[0][t] - lines[1][t])
    if (s === 0) continue
    if (last !== 0 && s !== last) k++
    last = s
  }
  return k
}

/**
 * Which composed line each stream is following, step by step.
 *
 * At a crossing a stream either *crosses* — keeps the line it was on, which
 * means passing through the other — or *bounces*, taking over the other line.
 * Grouping by height can only ever bounce. Whether the minimum-motion rule
 * ever crosses is the interesting question, and it needs this rather than a
 * comparison of the two notes as a set, which always matches because both
 * streams always hold both notes.
 */
export function following(streams: [number[], number[]], lines: [number[], number[]]): number[] {
  const out: number[] = []
  for (let t = 0; t < lines[0].length; t++) {
    // ambiguous while the lines are on the same degree; carry the last answer
    if (lines[0][t] === lines[1][t]) out.push(out.length ? out[out.length - 1] : 0)
    else out.push(streams[0][t] === lines[0][t] ? 0 : 1)
  }
  return out
}

/** Of the crossings in `lines`, how many did the streams pass through? */
export function crossedThrough(
  streams: [number[], number[]],
  lines: [number[], number[]],
): { crossed: number; total: number } {
  const f = following(streams, lines)
  let crossed = 0
  let total = 0
  let last = 0
  for (let t = 0; t < lines[0].length; t++) {
    const s = Math.sign(lines[0][t] - lines[1][t])
    if (s === 0) continue
    if (last !== 0 && s !== last) {
      total++
      // the stream crossed if it is still on the same line it was before
      let prev = t - 1
      while (prev > 0 && lines[0][prev] === lines[1][prev]) prev--
      if (f[t] === f[prev]) crossed++
    }
    last = s
  }
  return { crossed, total }
}

// -- writing the pieces -------------------------------------------------------

export const LO = -7
export const HI = 14

/**
 * Two smooth lines that cross as often as asked.
 *
 * Written as a centre and a gap rather than as two walks, because the crossing
 * rate is a property of the *gap* and nothing else: the lines cross exactly
 * when the gap changes sign. A pair of independent walks has a crossing rate
 * you cannot set — the first version of this tried and produced 2.9 crossings
 * per 64 steps whatever it was asked for.
 *
 * `cross` is crossings per step: the gap is cos(π·cross·t), whose sign changes
 * every 1/cross steps, so the count is cross·n by construction and can be
 * checked against the generator rather than trusted.
 *
 * Each line also gets a small walk of its own, because two lines that only
 * move as a rigid pair are not melodies — the first version had a mean step of
 * 0.098 degrees, which is a pair of held notes. The walk is bounded well inside
 * the gap so it does not manufacture crossings of its own.
 */
export function compose(n: number, seed: number, cross: number): [number[], number[]] {
  const r = rng(seed)
  const a: number[] = []
  const b: number[] = []
  const gapAmp = 5.5
  const phase = r.next() * Math.PI * 2
  let centre = 3 + r.int(-1, 1)
  let drift = r.range(-0.12, 0.12)
  let ja = 0
  let jb = 0
  for (let t = 0; t < n; t++) {
    // a slow, bounded wander for the pair as a whole
    drift += r.range(-0.05, 0.05)
    drift = Math.max(-0.22, Math.min(0.22, drift))
    centre += drift
    if (centre > 6) { centre = 6; drift = -Math.abs(drift) }
    if (centre < 0) { centre = 0; drift = Math.abs(drift) }
    // each line's own melodic motion, reflected at ±1.6 so it stays inside the gap
    ja = Math.max(-1.6, Math.min(1.6, ja + r.range(-0.9, 0.9)))
    jb = Math.max(-1.6, Math.min(1.6, jb + r.range(-0.9, 0.9)))
    // the gap, whose sign changes are the crossings
    const gap = cross > 0 ? gapAmp * Math.cos(Math.PI * cross * t + phase) : gapAmp
    a.push(Math.max(LO, Math.min(HI, Math.round(centre + gap / 2 + ja))))
    b.push(Math.max(LO, Math.min(HI, Math.round(centre - gap / 2 + jb))))
  }
  return [a, b]
}

/** The classic pair: one scale up, one down, meeting in the middle. */
export function scales(n: number): [number[], number[]] {
  const a: number[] = []
  const b: number[] = []
  const span = 8
  for (let t = 0; t < n; t++) {
    const k = t % (span * 2)
    const up = k < span ? k : span * 2 - k
    a.push(up)
    b.push(span - up)
  }
  return [a, b]
}

/** Decide which line goes left at each step. */
export function scatter(n: number, how: Scatter, seed: number): Side[] {
  const r = rng(seed * 977 + 3)
  const out: Side[] = []
  for (let t = 0; t < n; t++) {
    out.push(how === 'none' ? 0 : how === 'alternate' ? ((t % 2) as Side) : (r.int(0, 1) as Side))
  }
  return out
}
