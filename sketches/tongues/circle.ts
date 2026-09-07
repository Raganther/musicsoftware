/**
 * The sine circle map, and the mode locking that falls out of it.
 *
 *     θ_{n+1} = θ_n + Ω − (K/2π) · sin(2π θ_n)
 *
 * Read musically: a drive pulse arrives every step, and the oscillator's phase
 * advances by Ω, nudged by how far it is from the beat. It fires whenever the
 * phase passes a whole turn, so the *winding number* W — turns per drive pulse
 * — is literally the rhythm's density in events per pulse.
 *
 * At K = 0 the map is a rigid rotation: W = Ω exactly, and the fire/don't-fire
 * sequence is the Sturmian word `irrational` is built on. Turn K up and the
 * nonlinearity makes W stick: it locks to a rational p/q over a whole interval
 * of Ω, so the density becomes indifferent to the knob for a while and then
 * jumps. That is a devil's staircase, and it is the reason a groove feels like
 * it snaps to a ratio rather than sliding through all of them.
 *
 * The plateaus are the Arnold tongues. Their widths, the way they nest by the
 * Farey mediant, and the fractal dimension of what is left between them at
 * K = 1 are all known from outside this file, which is what makes them worth
 * measuring here rather than asserting.
 */

const TAU = Math.PI * 2

/** One iterate of the lifted map. θ is not wrapped: the integer part counts turns. */
export function step(theta: number, omega: number, K: number): number {
  return theta + omega - (K / TAU) * Math.sin(TAU * theta)
}

/**
 * The winding number: turns per drive pulse, averaged over a long orbit.
 *
 * On a locked plateau the orbit is periodic, so this is exact to within 1/iters
 * once the transient is gone — which is what makes a plateau detectable by
 * comparing neighbouring values rather than by hunting for the period.
 */
export function winding(omega: number, K: number, iters = 20000, warmup = 2000): number {
  let t = 0.31830988618 // an arbitrary irrational start, so no orbit begins on the fixed point
  for (let i = 0; i < warmup; i++) t = step(t, omega, K)
  const t0 = t
  for (let i = 0; i < iters; i++) t = step(t, omega, K)
  return (t - t0) / iters
}

/** The rational p/q nearest w with q ≤ maxQ, by Farey/Stern-Brocot descent. */
export function nearestRational(w: number, maxQ = 64): { p: number; q: number } {
  let lo = { p: 0, q: 1 }
  let hi = { p: 1, q: 1 }
  if (w <= 0) return lo
  if (w >= 1) return hi
  let best = { p: 0, q: 1 }
  let bestErr = Math.abs(w)
  for (let i = 0; i < 200; i++) {
    const mid = { p: lo.p + hi.p, q: lo.q + hi.q }
    if (mid.q > maxQ) break
    const err = Math.abs(w - mid.p / mid.q)
    if (err < bestErr) {
      bestErr = err
      best = mid
    }
    if (w < mid.p / mid.q) hi = mid
    else lo = mid
  }
  return best
}

/**
 * Where the p/q tongue sits at this K: the interval of Ω over which W = p/q.
 *
 * W is non-decreasing in Ω, so both edges are found by plain bisection with no
 * need to first land inside — which matters, because the narrow tongues are far
 * narrower than any grid you would think to search. Precision in W buys much
 * more precision in Ω than you would expect: the edge is a saddle-node, where
 * W − p/q grows as the square root of the distance, so resolving W to 1e−5
 * places the edge to about 1e−10.
 */
export function tongue(p: number, q: number, K: number, iters = 20000): { lo: number; hi: number } | null {
  const target = p / q
  const tol = 4 / iters
  const at = (o: number) => winding(o, K, iters, 1000)
  const bisect = (below: (w: number) => boolean) => {
    let a = 0
    let b = 1.4
    for (let i = 0; i < 50; i++) {
      const mid = (a + b) / 2
      if (below(at(mid))) a = mid
      else b = mid
    }
    return (a + b) / 2
  }
  const lo = bisect((w) => w < target - tol)
  const hi = bisect((w) => w <= target + tol)
  if (!(hi >= lo)) return null
  return { lo, hi }
}

/**
 * The event sequence: does the oscillator fire on drive pulse n?
 *
 * Returned as the phase after each step so a caller can both sound it and draw
 * it. `fired` is true on the steps where the phase passed a whole turn.
 */
export function run(
  omega: number,
  K: number,
  steps: number,
  theta0 = 0,
): { theta: number[]; fired: boolean[]; turns: number } {
  let t = theta0
  const theta: number[] = []
  const fired: boolean[] = []
  const start = Math.floor(t)
  for (let i = 0; i < steps; i++) {
    const before = Math.floor(t)
    t = step(t, omega, K)
    theta.push(t)
    fired.push(Math.floor(t) > before)
  }
  return { theta, fired, turns: Math.floor(t) - start }
}
