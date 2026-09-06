import { degree, type ScaleName } from '@core'

/**
 * A canon, solved exactly.
 *
 * `species` composes a counterpoint *against* a fixed cantus firmus: two
 * independent lines, and the dynamic program only ever has to remember the last
 * couple of notes. A canon is a harder object, because the second voice is the
 * first one shifted. Note i is heard against note i−d, so committing to a note
 * constrains the melody both forwards (what may follow) and backwards (what may
 * have been, d notes ago). The state has to carry the whole delay.
 *
 * Concretely: the harmonic rule at position i reads x[i] and x[i−d]; the
 * parallel-perfects rule also reads x[i−1] and x[i−d−1]; the melodic rules read
 * back three. So the DP state is the last W = max(d+1, 3) notes, and the space
 * is m^W states — 32,768 at eight candidates and a delay of four, which is
 * still exact and still about a tenth of a second.
 *
 * The pay-off for that width is the same as in `species`: exact counts, exact
 * per-note marginals, and uniform sampling. The number on screen is the number.
 */

export interface Rules {
  consonance: boolean
  parallels: boolean
  melody: boolean
  variety: boolean
  cadence: boolean
}

export const ALL_RULES: Rules = {
  consonance: true,
  parallels: true,
  melody: true,
  variety: true,
  cadence: true,
}

/** Consonant harmonic intervals, mod an octave. A fourth is not one of them. */
const CONSONANT = new Set([0, 3, 4, 7, 8, 9])
/** Perfect consonances — the ones you may not arrive at in parallel. */
const PERFECT = new Set([0, 7])
/** Melodic intervals a singer will take, in semitones. No tritone, no seventh. */
const SINGABLE = new Set([1, 2, 3, 4, 5, 7, 8, 9, 12])

const mod12 = (v: number) => ((v % 12) + 12) % 12

/** How many candidate scale degrees the melody may use. */
export const SPAN = 8

export interface Spec {
  /** MIDI pitch of each melody index, as the leader sings it. */
  lead: number[]
  /** MIDI pitch of each melody index, as the follower sings it — the same
   *  melody, moved by the interval of imitation. */
  foll: number[]
  n: number
  d: number
  rules: Rules
}

export function spec(
  root: number,
  scale: ScaleName,
  n: number,
  d: number,
  /** Interval of imitation, in scale steps. −4 is a fifth below. */
  q: number,
  rules: Rules,
  span = SPAN,
): Spec {
  const lead: number[] = []
  const foll: number[] = []
  for (let c = 0; c < span; c++) {
    lead.push(degree(root, scale, c))
    foll.push(degree(root, scale, c + q))
  }
  return { lead, foll, n, d, rules }
}

/**
 * Every rule, evaluated directly against a melody by array indexing.
 *
 * This is the definition; the dynamic program below is an optimisation of it,
 * and the two are compared by brute force in the harness. Accepts a partial
 * melody, which is how the DP's initial states are screened — the cadence rule
 * then only fires if the prefix happens to reach the end.
 */
export function violations(sp: Spec, x: number[]): string[] {
  const v: string[] = []
  const { lead, foll, n, d, rules } = sp
  for (let i = 0; i < x.length; i++) {
    if (rules.melody && i >= 1) {
      const step = Math.abs(lead[x[i]] - lead[x[i - 1]])
      if (step !== 0 && !SINGABLE.has(step)) v.push(`${i}: leap of ${step} semitones is not singable`)
    }
    if (rules.variety) {
      if (i >= 2 && x[i] === x[i - 1] && x[i - 1] === x[i - 2]) v.push(`${i}: three of the same note`)
      if (i >= 3) {
        const a = lead[x[i]] - lead[x[i - 1]]
        const b = lead[x[i - 1]] - lead[x[i - 2]]
        const c = lead[x[i - 2]] - lead[x[i - 3]]
        if (a !== 0 && a === b && b === c) v.push(`${i}: four notes marching in a straight line`)
      }
    }
    if (i >= d) {
      const A = lead[x[i]]
      const B = foll[x[i - d]]
      const iv = mod12(A - B)
      if (rules.consonance && !CONSONANT.has(iv)) v.push(`${i}: dissonance (${iv} semitones)`)
      if (rules.parallels && i >= d + 1) {
        const ap = lead[x[i - 1]]
        const bp = foll[x[i - d - 1]]
        if (PERFECT.has(iv) && iv === mod12(ap - bp) && A !== ap) {
          v.push(`${i}: parallel ${iv === 0 ? 'octaves' : 'fifths'}`)
        }
      }
      if (rules.cadence && i === n - 1 && !PERFECT.has(iv)) {
        v.push(`${i}: does not close on a perfect consonance`)
      }
    }
  }
  return v
}

/** Every candidate melody of length n over SPAN degrees. For validation only. */
export function bruteForce(sp: Spec, fixed?: number[]): { total: number; marg: Float64Array[] } {
  const m = sp.lead.length
  const marg: Float64Array[] = []
  for (let i = 0; i < sp.n; i++) marg.push(new Float64Array(m))
  const x = new Array(sp.n).fill(0)
  let total = 0
  const rec = (i: number) => {
    if (i === sp.n) {
      if (violations(sp, x).length) return
      total++
      for (let j = 0; j < sp.n; j++) marg[j][x[j]]++
      return
    }
    for (let c = 0; c < m; c++) {
      if (fixed && fixed[i] >= 0 && c !== fixed[i]) continue
      x[i] = c
      rec(i + 1)
    }
  }
  rec(0)
  return { total, marg }
}

export class Canon {
  readonly m: number
  /** How many notes of history the state carries. */
  readonly W: number
  readonly S: number
  readonly total: number
  /** marg[i][c] — how many legal canons use candidate c at position i. */
  readonly marg: Float64Array[]
  private pw: number[] = []
  /** F[i] / B[i] are stored at index i − W. */
  private F: Float64Array[] = []
  private B: Float64Array[] = []

  constructor(
    readonly sp: Spec,
    /** fixed[i] is a committed candidate index, or −1. */
    readonly fixed: number[],
  ) {
    const { n, d } = sp
    const m = sp.lead.length
    this.m = m
    this.W = Math.max(d + 1, 3)
    if (n <= this.W) throw new Error('melody shorter than the state it needs')
    for (let k = 0; k <= this.W; k++) this.pw.push(m ** k)
    this.S = this.pw[this.W]
    const S = this.S

    // -- the prefix: enumerate it, and screen it with the definition ---------
    // Positions 0..W−1 have no state behind them, so rather than inventing a
    // sentinel the DP starts from every legal prefix. Screening them through
    // `violations` also means the awkward end of the melody is checked by the
    // same code that defines the rules.
    const first = new Float64Array(S)
    const pre = new Array(this.W).fill(0)
    for (let s = 0; s < S; s++) {
      let ok = true
      for (let j = 0; j < this.W; j++) {
        const c = Math.floor(s / this.pw[this.W - 1 - j]) % m
        if (fixed[j] >= 0 && c !== fixed[j]) {
          ok = false
          break
        }
        pre[j] = c
      }
      if (ok && violations(sp, pre).length === 0) first[s] = 1
    }

    // -- backward: how many ways to finish from here -------------------------
    for (let i = this.W; i <= n; i++) this.B.push(new Float64Array(S))
    this.B[n - this.W].fill(1)
    for (let i = n - 1; i >= this.W; i--) {
      const cur = this.B[i - this.W]
      const nxt = this.B[i + 1 - this.W]
      const fx = fixed[i]
      for (let s = 0; s < S; s++) {
        const base = (s % this.pw[this.W - 1]) * m
        let sum = 0
        for (let c = 0; c < m; c++) {
          if (fx >= 0 && c !== fx) continue
          if (!this.ok(s, c, i)) continue
          sum += nxt[base + c]
        }
        cur[s] = sum
      }
    }

    // -- forward: how many ways to arrive ------------------------------------
    for (let i = this.W; i <= n; i++) this.F.push(new Float64Array(S))
    this.F[0].set(first)
    for (let i = this.W; i < n; i++) {
      const cur = this.F[i - this.W]
      const nxt = this.F[i + 1 - this.W]
      const fx = fixed[i]
      for (let s = 0; s < S; s++) {
        const f = cur[s]
        if (f === 0) continue
        const base = (s % this.pw[this.W - 1]) * m
        for (let c = 0; c < m; c++) {
          if (fx >= 0 && c !== fx) continue
          if (!this.ok(s, c, i)) continue
          nxt[base + c] += f
        }
      }
    }

    let total = 0
    const f0 = this.F[0]
    const b0 = this.B[0]
    for (let s = 0; s < S; s++) total += f0[s] * b0[s]
    this.total = total

    // -- marginals ------------------------------------------------------------
    this.marg = []
    for (let i = 0; i < n; i++) this.marg.push(new Float64Array(m))
    // inside the prefix, read the digits of the joined weight
    for (let s = 0; s < S; s++) {
      const wgt = f0[s] * b0[s]
      if (wgt === 0) continue
      for (let j = 0; j < this.W; j++) {
        this.marg[j][Math.floor(s / this.pw[this.W - 1 - j]) % m] += wgt
      }
    }
    for (let i = this.W; i < n; i++) {
      const cur = this.F[i - this.W]
      const nxt = this.B[i + 1 - this.W]
      const fx = fixed[i]
      const mg = this.marg[i]
      for (let s = 0; s < S; s++) {
        const f = cur[s]
        if (f === 0) continue
        const base = (s % this.pw[this.W - 1]) * m
        for (let c = 0; c < m; c++) {
          if (fx >= 0 && c !== fx) continue
          if (!this.ok(s, c, i)) continue
          mg[c] += f * nxt[base + c]
        }
      }
    }
  }

  /**
   * May position i take candidate c, given the W notes before it encoded in s?
   *
   * Only ever called for i >= W, so every note this reaches back for is a real
   * one — which is exactly why W is what it is.
   */
  private ok(s: number, c: number, i: number): boolean {
    const { lead, foll, n, d, rules } = this.sp
    const m = this.m
    const at = (k: number) => Math.floor(s / this.pw[k - 1]) % m
    const a1 = at(1)
    if (rules.melody) {
      const step = Math.abs(lead[c] - lead[a1])
      if (step !== 0 && !SINGABLE.has(step)) return false
    }
    if (rules.variety) {
      const a2 = at(2)
      if (c === a1 && a1 === a2) return false
      const u = lead[c] - lead[a1]
      if (u !== 0 && u === lead[a1] - lead[a2] && u === lead[a2] - lead[at(3)]) return false
    }
    const A = lead[c]
    const B = foll[at(d)]
    const iv = mod12(A - B)
    if (rules.consonance && !CONSONANT.has(iv)) return false
    if (rules.parallels && PERFECT.has(iv)) {
      const ap = lead[a1]
      if (iv === mod12(ap - foll[at(d + 1)]) && A !== ap) return false
    }
    if (rules.cadence && i === n - 1 && !PERFECT.has(iv)) return false
    return true
  }

  /** A melody drawn uniformly from the legal ones. Null if there are none. */
  sample(r: { next(): number }): number[] | null {
    if (this.total <= 0) return null
    const { n } = this.sp
    const m = this.m
    const f0 = this.F[0]
    const b0 = this.B[0]
    let t = r.next() * this.total
    let s = 0
    for (; s < this.S - 1; s++) {
      t -= f0[s] * b0[s]
      if (t <= 0) break
    }
    const x: number[] = []
    for (let j = 0; j < this.W; j++) x.push(Math.floor(s / this.pw[this.W - 1 - j]) % m)
    for (let i = this.W; i < n; i++) {
      const nxt = this.B[i + 1 - this.W]
      const base = (s % this.pw[this.W - 1]) * m
      const fx = this.fixed[i]
      let tot = 0
      const w = new Float64Array(m)
      for (let c = 0; c < m; c++) {
        if (fx >= 0 && c !== fx) continue
        if (!this.ok(s, c, i)) continue
        w[c] = nxt[base + c]
        tot += w[c]
      }
      if (tot <= 0) return null
      let u = r.next() * tot
      let pick = -1
      for (let c = 0; c < m; c++) {
        u -= w[c]
        if (w[c] > 0 && u <= 0) {
          pick = c
          break
        }
      }
      if (pick < 0) for (let c = m - 1; c >= 0; c--) if (w[c] > 0) { pick = c; break }
      x.push(pick)
      s = base + pick
    }
    return x
  }

  /** The two voices as MIDI, position by position. −1 where a voice is silent. */
  voices(x: number[]): { lead: number[]; foll: number[] } {
    const { n, d } = this.sp
    const lead: number[] = []
    const foll: number[] = []
    for (let i = 0; i < n + d; i++) {
      lead.push(i < n ? this.sp.lead[x[i]] : -1)
      foll.push(i >= d ? this.sp.foll[x[i - d]] : -1)
    }
    return { lead, foll }
  }
}
