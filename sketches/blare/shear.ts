/**
 * Finite-amplitude propagation: why a trombone gets brassy when it gets loud.
 *
 * Every bore in this repo — `overblow`, `cone`, `lattice` — propagates linearly,
 * so its timbre is whatever the excitation and the resonances make it, and
 * playing louder only makes it louder. Real air does not work that way. A
 * compression is hotter than a rarefaction, so it travels faster, so the crest
 * of a wave catches up with the trough ahead of it and the waveform **shears**
 * as it goes. A sine turns into a sawtooth over enough distance, and a sawtooth
 * is a brass instrument.
 *
 * The lossless simple-wave (Poisson) solution is implicit:
 *
 *     u(σ, φ) = u₀(φ + σ·u)
 *
 * with everything about amplitude, frequency and distance folded into the one
 * dimensionless number σ = β·û·ω·x/c₀². At σ = 1 the map stops being invertible:
 * that is a shock, and it is the same condition as the fixed-point iteration
 * below ceasing to contract.
 *
 * For an initially sinusoidal wave the Fourier series of that has a closed form
 * — Fubini, 1935 — in Bessel functions, which is an independent check on the
 * iteration rather than a restatement of it.
 *
 * No imports: run directly under `node --experimental-strip-types`.
 */

/** Shock formation: σ = 1, where the shear map first becomes multivalued. */
export const SHOCK = 1

/**
 * `J_n(x)` from its integral representation, `(1/π)∫₀^π cos(nτ − x sin τ) dτ`.
 * Series and recurrences both lose digits here; a smooth periodic integrand
 * under the trapezium rule converges geometrically and needs no care.
 */
export function besselJ(n: number, x: number, steps = 0): number {
  // The integrand oscillates about (n + x) times across the interval, so the
  // step count has to grow with both. A fixed 2048 is good to 1e-11 at J5(10)
  // and only 1e-4 at J10(20), which is inside the range Fubini needs.
  // `ceil`, and not for tidiness: a fractional step count puts the last grid
  // point somewhere other than π, so the endpoint term lands in the wrong
  // place. Every J with an integer count came out to 1e-15 and every J with a
  // fractional one to 1e-3.
  const m = Math.ceil(steps || Math.max(4096, 256 * (Math.abs(n) + Math.abs(x))))
  let s = 0
  for (let i = 1; i < m; i++) {
    const tau = (Math.PI * i) / m
    s += Math.cos(n * tau - x * Math.sin(tau))
  }
  s += 0.5 * (1 + Math.cos(n * Math.PI))
  return s / m
}

/**
 * Fubini: the amplitude of the nth harmonic of an initially sinusoidal wave
 * after dimensionless distance σ, as a fraction of the original amplitude.
 * Exact for σ ≤ 1 and meaningless past it, because past it there is a shock.
 */
export function fubini(n: number, sigma: number): number {
  if (sigma <= 0) return n === 1 ? 1 : 0
  return (2 / (n * sigma)) * besselJ(n, n * sigma)
}

/**
 * The lossless weak-shock ("sawtooth") law that takes over once the shock has
 * formed: the wave is a sawtooth whose amplitude decays as 1/(1+σ), so every
 * harmonic falls as `2/(n(1+σ))`. Blackstock's solution, valid for σ ≳ 1.
 */
export function sawtooth(n: number, sigma: number): number {
  return 2 / (n * (1 + sigma))
}

export interface ShearPoint {
  u: number
  iters: number
  converged: boolean
}

/**
 * One point of the sheared wave, by iterating `u ← u₀(φ + σ·u)` to a fixed
 * point.
 *
 * The iteration contracts exactly while `|σ·u₀′| < 1`, which for a unit sine is
 * `σ < 1` — so the numerical method fails precisely where the physics does, and
 * `converged` is a shock detector rather than a tolerance.
 */
export function shearAt(
  u0: (phi: number) => number,
  du0: (phi: number) => number,
  phi: number,
  sigma: number,
  iters = 60,
  tol = 1e-14,
): ShearPoint {
  // Newton on u − u₀(φ + σu) = 0. Plain fixed-point iteration contracts by
  // |σ·u₀′| and so crawls near the shock — 200 steps still left 1.4e−2 of
  // error at σ = 0.99. Newton is quadratic and stays sharp right up to it.
  let u = u0(phi)
  for (let i = 0; i < iters; i++) {
    const arg = phi + sigma * u
    const f = u - u0(arg)
    const df = 1 - sigma * du0(arg)
    if (Math.abs(df) < 1e-12) return { u, iters: i + 1, converged: false }
    const next = u - f / df
    if (Math.abs(next - u) < tol) return { u: next, iters: i + 1, converged: true }
    u = next
  }
  return { u, iters, converged: false }
}

/** One period of an initially sinusoidal wave after distance σ, in `n` samples. */
export function shearWave(n: number, sigma: number): { wave: Float64Array; converged: boolean; worst: number } {
  const wave = new Float64Array(n)
  let converged = true
  let worst = 0
  const u0 = (phi: number) => Math.sin(phi)
  const du0 = (phi: number) => Math.cos(phi)
  for (let i = 0; i < n; i++) {
    const r = shearAt(u0, du0, (2 * Math.PI * i) / n, sigma)
    wave[i] = r.u
    if (!r.converged) converged = false
    if (r.iters > worst) worst = r.iters
  }
  return { wave, converged, worst }
}

/**
 * Sine-component amplitudes of one period. The sheared wave is odd about the
 * origin in the same way the source is, so the sine coefficients hold all of it
 * and the cosine ones are a check that nothing has drifted.
 */
export function harmonics(wave: Float64Array, upto: number): { sin: number[]; cos: number[] } {
  const n = wave.length
  const sin: number[] = []
  const cos: number[] = []
  for (let k = 1; k <= upto; k++) {
    let a = 0
    let b = 0
    for (let i = 0; i < n; i++) {
      const phi = (2 * Math.PI * k * i) / n
      a += wave[i] * Math.sin(phi)
      b += wave[i] * Math.cos(phi)
    }
    sin.push((2 * a) / n)
    cos.push((2 * b) / n)
  }
  return { sin, cos }
}

/**
 * Where the waveform is steepest, as a multiple of the source's steepest slope.
 * It is `1/(1−σ)` for a simple wave and runs away at the shock — the same
 * statement as the iteration failing, in a quantity you can see on a scope.
 */
export function steepness(wave: Float64Array): number {
  const n = wave.length
  let worst = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(wave[(i + 1) % n] - wave[i])
    if (d > worst) worst = d
  }
  return (worst * n) / (2 * Math.PI)
}

/** Spectral centroid of a harmonic series, in harmonic numbers, weighted by power. */
export function centroid(amps: number[]): number {
  let num = 0
  let den = 0
  for (let i = 0; i < amps.length; i++) {
    const p = amps[i] * amps[i]
    num += (i + 1) * p
    den += p
  }
  return den > 0 ? num / den : 1
}
