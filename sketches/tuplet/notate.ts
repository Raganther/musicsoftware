/**
 * What a rhythm costs to write down.
 *
 * `elastic` solves a rhythm from stated ratios and hands back *real numbers*.
 * Notation cannot express a real number. It can express a dyadic fraction of a
 * bar — halves, quarters, eighths — and it can scale that by a tuplet, n notes
 * in the time of m. Tuplets nest, so the reachable durations are
 *
 *     2^(-k) · Π (m_i / n_i)
 *
 * and the denominator of anything you can write is a product of the tuplet
 * numbers you are willing to use. With tuplets up to N, **a duration is
 * notatable exactly when its denominator is N-smooth** — no prime factor larger
 * than N. That is the whole constraint, and it is a fact about numbers rather
 * than about music.
 *
 * The other half is `elastic`'s: the durations have to *add up*. So notating a
 * bar is not rounding each duration on its own — round independently and the
 * bar no longer closes. It is choosing one denominator for the bar and then
 * distributing what is left over, which is also what a person does.
 */

/** The odd part of n. Powers of two are free — they are just beams and dots. */
export function oddPart(n: number): number {
  while (n % 2 === 0) n /= 2
  return n
}

/**
 * The fewest nested tuplets needed to reach denominator `d`, or Infinity.
 *
 * Each level of nesting contributes one factor no larger than `maxTuplet`, so
 * this is the shortest factorisation of the odd part into factors in [3, N].
 */
const levelCache = new Map<number, number>()

export function levels(d: number, maxTuplet: number): number {
  const key = Math.round(d) * 64 + maxTuplet
  const hit = levelCache.get(key)
  if (hit !== undefined) return hit
  const out = levelsUncached(d, maxTuplet)
  levelCache.set(key, out)
  return out
}

function levelsUncached(d: number, maxTuplet: number): number {
  const odd = oddPart(Math.round(d))
  if (odd === 1) return 0
  if (maxTuplet < 3) return Infinity
  // shortest factorisation, by breadth-first over divisors
  const seen = new Map<number, number>([[odd, 0]])
  const queue: number[] = [odd]
  while (queue.length) {
    const cur = queue.shift() as number
    const n = seen.get(cur) as number
    for (let f = 3; f <= Math.min(maxTuplet, cur); f += 2) {
      if (cur % f !== 0) continue
      const next = cur / f
      if (next === 1) return n + 1
      if (!seen.has(next)) {
        seen.set(next, n + 1)
        queue.push(next)
      }
    }
  }
  return Infinity
}

/**
 * Denominators reachable within the budget, smallest first.
 *
 * Three axes, and the third is easy to forget: a denominator is a plain
 * subdivision of the bar times a stack of tuplets, and notation limits *both*.
 * `maxDyadic` is the shortest note value — 16 means sixteenth notes — and
 * without it the budget never binds. Left out, this reported 0.09% error for a
 * rhythm written with no tuplets at all, which is what you get when the model
 * is quietly allowed 512nd notes.
 */
export function denominators(maxTuplet: number, maxDepth: number, maxDyadic = 16): number[] {
  const out: number[] = []
  for (let two = 1; two <= maxDyadic; two *= 2) {
    for (let odd = 1; odd <= 512; odd += 2) {
      if (levels(odd, maxTuplet) <= maxDepth) out.push(two * odd)
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

export interface Notation {
  /** Numerator per note, over `den`. */
  parts: number[]
  den: number
  /** Nesting depth used. */
  depth: number
  /** Realised durations as fractions of the bar. */
  durs: number[]
  /** Largest single-note error, as a fraction of the bar. */
  worst: number
  /** Sum of |error| over the bar. */
  total: number
  /**
   * False when the budget cannot hold this many notes at all, in which case
   * `den` is over budget and the bar is simply unwritable as asked.
   */
  ok: boolean
}

/**
 * Write a bar of durations (fractions of the bar, summing to 1) at a given
 * denominator, keeping the bar closed.
 *
 * Round every note, then hand the leftover to whoever was rounded furthest in
 * the wrong direction — the bar has to come out exact, so somebody pays.
 */
export function atDenominator(durs: number[], den: number): Notation {
  const scaled = durs.map((d) => d * den)
  const parts = scaled.map((v) => Math.max(1, Math.round(v)))
  let residual = den - parts.reduce((a, b) => a + b, 0)
  // hand out (or take back) one unit at a time, always to the note that is
  // currently furthest from where it wanted to be
  while (residual !== 0) {
    const dir = Math.sign(residual)
    let best = -1
    let bestGain = -Infinity
    for (let i = 0; i < parts.length; i++) {
      if (dir < 0 && parts[i] <= 1) continue
      const before = Math.abs(parts[i] - scaled[i])
      const after = Math.abs(parts[i] + dir - scaled[i])
      const gain = before - after
      if (gain > bestGain) {
        bestGain = gain
        best = i
      }
    }
    if (best < 0) break
    parts[best] += dir
    residual -= dir
  }
  const realised = parts.map((p) => p / den)
  let worst = 0
  let total = 0
  for (let i = 0; i < durs.length; i++) {
    const e = Math.abs(realised[i] - durs[i])
    worst = Math.max(worst, e)
    total += e
  }
  return { parts, den, depth: levels(den, 64), durs: realised, worst, total, ok: true }
}

/**
 * The best way to write these durations within a tuplet budget.
 *
 * Searches every reachable denominator rather than guessing one, because the
 * cheapest denominator is not always the smallest — 12 beats 8 for a rhythm in
 * thirds, and neither is obvious from the durations.
 */
export function bestNotation(
  durs: number[],
  maxTuplet: number,
  maxDepth: number,
  maxDyadic = 16,
): Notation {
  const feasible = denominators(maxTuplet, maxDepth, maxDyadic).filter((d) => d >= durs.length)
  if (feasible.length === 0) {
    // A budget with fewer slots than notes cannot write this bar at all — five
    // notes do not fit on a grid of quarters however you round them. Say so and
    // show what it would take, rather than quietly reaching outside the budget.
    // An earlier version did exactly that: asked for no tuplets at all, it
    // handed back denominator 5, which needs a quintuplet. The known-answer
    // check caught it on its first run.
    const any = denominators(13, 4, 4096).filter((d) => d >= durs.length)
    return { ...atDenominator(durs, any[0] ?? durs.length), ok: false }
  }
  let best: Notation | null = null
  for (const den of feasible) {
    const n = atDenominator(durs, den)
    if (!best || n.worst < best.worst - 1e-12) best = n
  }
  return best as Notation
}

/**
 * The best rational approximation to x with denominator at most `q`, by
 * continued fractions — with no smoothness restriction at all.
 *
 * The comparison that says what notation actually costs: the same denominator
 * size, but allowed to be any integer rather than a product of small ones.
 */
export function bestRational(x: number, q: number): { p: number; q: number } {
  let lo = { p: 0, q: 1 }
  let hi = { p: 1, q: 0 }
  let best = { p: Math.round(x), q: 1 }
  let err = Math.abs(x - best.p)
  for (let i = 0; i < 200; i++) {
    const mid = { p: lo.p + hi.p, q: lo.q + hi.q }
    if (mid.q > q) break
    const v = mid.p / mid.q
    const e = Math.abs(x - v)
    if (e < err) {
      err = e
      best = mid
    }
    if (v < x) lo = mid
    else hi = mid
  }
  return best
}

/** Is d's denominator free of prime factors above N? */
export function isSmooth(d: number, n: number): boolean {
  let x = Math.round(d)
  for (let f = 2; f <= n; f++) while (x % f === 0) x /= f
  return x === 1
}
