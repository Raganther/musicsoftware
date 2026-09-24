/**
 * An ensemble sharing a bar out between them, by ear, with nobody counting.
 *
 * `entrain` put players on a ring and had them agree on a tempo; the repulsive
 * version of that — "get away from whoever you can hear" — produced two camps
 * rather than an even spread, and the note in `research/ideas.md` said why:
 * an even ring requires knowing how many players there are, and no player does.
 *
 * There is a rule that does not need to know. Listen only to the player
 * immediately *before* you and the one immediately *after* you, and move to the
 * midpoint of the gap they leave. Nobody counts, nobody leads, and the ensemble
 * lands on a perfect round-robin. It is Degesys and Nagpal's DESYNC (2007),
 * built for radios sharing a channel, and it is a hocket that assembles itself.
 *
 * The error dynamics are the discrete heat equation on a ring, so everything
 * about it is a closed form — see `predictedDecay` and `STABLE_BELOW`.
 *
 * No imports: this file is run directly under `node --experimental-strip-types`.
 */

export type Rule = 'midpoint' | 'repel all' | 'repel nearest' | 'none'
export const RULES: Rule[] = ['midpoint', 'repel all', 'repel nearest', 'none']

export interface State {
  /**
   * Firing phases, one per player, as an ascending ladder spanning less than a
   * whole bar. Kept unwrapped so the sum is literally conserved and the
   * neighbour relation is just `i ± 1`.
   */
  p: number[]
  /** Times two players have swapped places. The midpoint rule should never. */
  swaps: number
  rounds: number
  /** The sum of the phases at the start, which the midpoint rule preserves. */
  sum0: number
}

export function start(n: number, rand: () => number, scatter: number): State {
  // Everyone bunched at the top of the bar, spread by `scatter`. At scatter 1
  // it is uniform; at 0 it is a single flam that has to push itself apart.
  const p: number[] = []
  for (let i = 0; i < n; i++) p.push(((i + 0.5) / n) * scatter + rand() * 0.002)
  p.sort((a, b) => a - b)
  return { p, swaps: 0, rounds: 0, sum0: p.reduce((s, x) => s + x, 0) }
}

/** The circular gaps between consecutive players, in bar fractions. Sums to 1. */
export function gaps(p: number[]): number[] {
  const n = p.length
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(i === n - 1 ? p[0] + 1 - p[n - 1] : p[i + 1] - p[i])
  return out
}

/**
 * How unevenly the bar is shared: the RMS departure of the gaps from `1/n`, as
 * a fraction of `1/n`. Zero is a perfect round-robin, and 1 is a departure the
 * size of the ideal gap itself.
 */
export function unevenness(p: number[]): number {
  const n = p.length
  if (n < 2) return 0
  const ideal = 1 / n
  let s = 0
  for (const g of gaps(p)) s += (g - ideal) * (g - ideal)
  return Math.sqrt(s / n) / ideal
}

/**
 * The Kuramoto order parameter — how *bunched* the ensemble is, 1 for everyone
 * together and 0 for "spread out". It is the obvious statistic and it cannot
 * tell an even ring from two opposite clumps: both read 0.
 */
export function order(p: number[]): number {
  let x = 0
  let y = 0
  for (const v of p) {
    x += Math.cos(2 * Math.PI * v)
    y += Math.sin(2 * Math.PI * v)
  }
  return Math.hypot(x, y) / p.length
}

/**
 * One bar. Everyone has heard the whole of the last one and re-places
 * themselves for the next, all at once.
 */
export function advance(s: State, alpha: number, rule: Rule): void {
  const n = s.p.length
  s.rounds++
  if (n < 2 || rule === 'none') return
  const q = new Array<number>(n)

  if (rule === 'midpoint') {
    for (let i = 0; i < n; i++) {
      const left = i === 0 ? s.p[n - 1] - 1 : s.p[i - 1]
      const right = i === n - 1 ? s.p[0] + 1 : s.p[i + 1]
      q[i] = (1 - alpha) * s.p[i] + alpha * ((left + right) / 2)
    }
  } else if (rule === 'repel all') {
    // Repulsive Kuramoto: push away from everyone you can hear, in proportion
    // to how nearly you agree with them. The mean field, which is what `entrain`
    // had and what has no idea how many players there are.
    for (let i = 0; i < n; i++) {
      let f = 0
      for (let j = 0; j < n; j++) if (j !== i) f += Math.sin(2 * Math.PI * (s.p[i] - s.p[j]))
      q[i] = s.p[i] + (alpha / n) * (f / (2 * Math.PI))
    }
  } else {
    // Push away from the single closest player, which is the most local rule
    // that is not the midpoint one.
    for (let i = 0; i < n; i++) {
      let best = Infinity
      let dir = 0
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        let d = s.p[i] - s.p[j]
        d -= Math.round(d)
        if (Math.abs(d) < Math.abs(best)) {
          best = d
          dir = Math.sign(d) || 1
        }
      }
      q[i] = s.p[i] + alpha * dir * Math.max(0, 1 / (2 * n) - Math.abs(best))
    }
  }

  // Order is preserved by the midpoint rule for alpha <= 1 — the midpoint of
  // your neighbours is strictly between them — so a swap is the signature of
  // over-correction, and an integer that should read zero.
  for (let i = 0; i < n - 1; i++) if (q[i] > q[i + 1]) s.swaps++
  if (q[0] + 1 < q[n - 1]) s.swaps++
  s.p = q
  s.p.sort((a, b) => a - b)
}

/**
 * The mode where one player is early and the one opposite is late — the
 * longest wavelength around the ring, and the one that takes longest to even
 * out *when the correction is gentle*.
 */
export function slowMode(n: number, alpha: number): number {
  return Math.abs(1 - alpha * (1 - Math.cos((2 * Math.PI) / n)))
}

/**
 * The per-bar factor the ensemble actually settles to: the largest eigenvalue
 * that is not mode 0.
 *
 * It is *not* always `slowMode`. The shortest wavelength — every other player
 * early, then late — has eigenvalue `1 − 2α`, which for few players and a
 * strong correction outlives the long one. At four players and α = 0.8 the
 * alternating mode decays at 0.6 while `slowMode` says 0.2, and the ensemble
 * obeys the 0.6. Taking the k = 1 mode for granted is what got that wrong.
 */
export function predictedDecay(n: number, alpha: number): number {
  let worst = 0
  for (let k = 1; k < n; k++) {
    const v = Math.abs(1 - alpha + alpha * Math.cos((2 * Math.PI * k) / n))
    if (v > worst) worst = v
  }
  return worst
}

/**
 * The shortest-wavelength mode has eigenvalue `1 − 2α`, so the rule diverges at
 * and above this regardless of how many players there are. At exactly 1 it has
 * eigenvalue −1: an even ensemble flips between two arrangements forever, and
 * an odd one, which has no such mode, still converges.
 */
export const STABLE_BELOW = 1

/**
 * The correction strength that converges fastest, from balancing the longest
 * wavelength against the shortest. **It depends on how many players there are**
 * — which is the one thing the rule itself never needs to know. An ensemble can
 * share the bar out perfectly without counting itself, and still cannot tune
 * how quickly it does so without counting itself.
 */
export function bestAlpha(n: number): number {
  const c1 = Math.cos((2 * Math.PI) / n)
  const cm = Math.cos((2 * Math.PI * Math.floor(n / 2)) / n)
  return 2 / (2 - c1 - cm)
}

/** All eigenvalues of the update, largest magnitude first. */
export function spectrum(n: number, alpha: number): number[] {
  const out: number[] = []
  for (let k = 0; k < n; k++) out.push((1 - alpha) + alpha * Math.cos((2 * Math.PI * k) / n))
  return out.sort((a, b) => Math.abs(b) - Math.abs(a))
}

export interface Run {
  trace: number[]
  orderTrace: number[]
  swaps: number
  /** The measured per-bar factor, fitted over the window where it is decaying. */
  rate: number
  final: number
  /** Departure of the phase sum from where it started. */
  drift: number
}

export function simulate(
  n: number,
  rand: () => number,
  scatter: number,
  alpha: number,
  rule: Rule,
  rounds: number,
): Run {
  const s = start(n, rand, scatter)
  const trace = [unevenness(s.p)]
  const orderTrace = [order(s.p)]
  for (let r = 0; r < rounds; r++) {
    advance(s, alpha, rule)
    trace.push(unevenness(s.p))
    orderTrace.push(order(s.p))
  }
  return {
    trace,
    orderTrace,
    swaps: s.swaps,
    rate: fitRate(trace),
    final: trace[trace.length - 1],
    drift: Math.abs(s.p.reduce((a, b) => a + b, 0) - s.sum0),
  }
}

/**
 * Geometric decay factor of a trace, from a least-squares line through its log
 * — over the stretch after the transient and before it hits the floating-point
 * floor, because outside that window the slope is measuring neither.
 */
export function fitRate(trace: number[], floor = 1e-11): number {
  const idx: number[] = []
  for (let i = 1; i < trace.length; i++) if (trace[i] > floor && trace[i] < trace[0]) idx.push(i)
  if (idx.length < 4) return NaN
  const use = idx.slice(Math.floor(idx.length * 0.15), Math.floor(idx.length * 0.9))
  if (use.length < 3) return NaN
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const i of use) {
    const y = Math.log(trace[i])
    sx += i
    sy += y
    sxx += i * i
    sxy += i * y
  }
  const m = use.length
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx)
  return Math.exp(slope)
}
