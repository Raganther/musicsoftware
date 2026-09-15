/**
 * A bore with a row of tone holes, as a transmission line.
 *
 * `overblow` had one vent — a hole at a position, which shortens the tube.
 * A real woodwind has a *lattice* of them, and a lattice does something a
 * single hole cannot: it is a periodic structure, so it has a stopband and a
 * passband. Below a cutoff the wave cannot propagate past the open holes and
 * turns back; above it, the lattice is transparent and the sound runs down the
 * whole tube and out.
 *
 * That cutoff is a property of the *holes* — their size, their spacing, the
 * wall they are drilled through — and not of which ones you happen to be
 * covering. So every note on the instrument shares one spectral ceiling, which
 * is a large part of why a clarinet sounds like a clarinet from bottom to top.
 *
 * Two independent routes to it here, which is the point of building both:
 *   - `cutoff()` solves the infinite lattice's Bloch dispersion relation, where
 *     the cutoff is exactly where a unit cell stops being evanescent;
 *   - `impedance()` chains the real, finite, fingered bore, where the cutoff
 *     has to show up as the resonance peaks losing their grip.
 * Neither knows about the other.
 */

/** Speed of sound in air, m/s, and its density, kg/m³. */
export const C = 343
export const RHO = 1.2

export interface Hole {
  /** Distance from the reed end, m. */
  x: number
  /** Hole radius, m. */
  b: number
  /** Wall thickness the hole is drilled through, m. */
  t: number
  open: boolean
}

export interface Bore {
  /** Total length, m. */
  L: number
  /** Bore radius, m. */
  a: number
  holes: Hole[]
}

// -- complex arithmetic, just enough -----------------------------------------

export type Cx = [number, number]
const cx = (re: number, im = 0): Cx => [re, im]
const add = (p: Cx, q: Cx): Cx => [p[0] + q[0], p[1] + q[1]]
const mul = (p: Cx, q: Cx): Cx => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]]
const div = (p: Cx, q: Cx): Cx => {
  const d = q[0] * q[0] + q[1] * q[1]
  return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]
}
export const abs = (p: Cx) => Math.hypot(p[0], p[1])

/** A 2×2 complex matrix, row-major. */
export type Mat = [Cx, Cx, Cx, Cx]
const matmul = (A: Mat, B: Mat): Mat => [
  add(mul(A[0], B[0]), mul(A[1], B[2])),
  add(mul(A[0], B[1]), mul(A[1], B[3])),
  add(mul(A[2], B[0]), mul(A[3], B[2])),
  add(mul(A[2], B[1]), mul(A[3], B[3])),
]

const ccos = (p: Cx): Cx => [Math.cos(p[0]) * Math.cosh(p[1]), -Math.sin(p[0]) * Math.sinh(p[1])]
const csin = (p: Cx): Cx => [Math.sin(p[0]) * Math.cosh(p[1]), Math.cos(p[0]) * Math.sinh(p[1])]

// -- the pieces ---------------------------------------------------------------

/** Characteristic impedance of a cylindrical bore of radius a. */
export const zc = (a: number) => (RHO * C) / (Math.PI * a * a)

/**
 * Wavenumber with viscothermal wall loss. Without it every resonance is
 * infinitely sharp and the cutoff has nothing to blunt.
 */
export function wavenumber(f: number, a: number, loss: number): Cx {
  const w = 2 * Math.PI * f
  const alpha = loss * 3.0e-5 * Math.sqrt(Math.max(1, f)) / Math.max(1e-4, a)
  return [w / C, -alpha]
}

/** Transfer matrix of a length l of cylindrical bore, (P,U) at the near end. */
export function section(f: number, l: number, a: number, loss: number): Mat {
  const k = wavenumber(f, a, loss)
  const kl: Cx = [k[0] * l, k[1] * l]
  const Z = cx(zc(a))
  const co = ccos(kl)
  const si = csin(kl)
  return [co, mul(cx(0, 1), mul(Z, si)), div(mul(cx(0, 1), si), Z), co]
}

/**
 * Shunt impedance of one tone hole.
 *
 * Open, it is the inertance of the short air column in the chimney plus its end
 * corrections — low impedance, so it shorts the bore to the outside. Closed, it
 * is the compliance of the little trapped volume, which is nearly an open
 * circuit and nearly does nothing. Nearly, not exactly: the closed holes are
 * why a cross-fingering works at all.
 */
export function holeImpedance(f: number, h: Hole, lossless = false): Cx {
  const w = 2 * Math.PI * f
  const area = Math.PI * h.b * h.b
  if (h.open) {
    // chimney height plus inner and outer end corrections
    const te = h.t + 0.75 * h.b + 0.85 * h.b
    const inertance = (RHO * te) / area
    // Radiation resistance of the little opening. Real, so it makes the hole
    // lossy — which is right for the instrument and wrong for the dispersion
    // relation, where the cell has to be lossless for cos(Γs) to be a real
    // number at all. Dropping it is what `lossless` is for.
    const k = w / C
    const rad = lossless ? 0 : ((RHO * C) / area) * 0.25 * (k * h.b) ** 2
    return [rad, w * inertance]
  }
  const volume = area * h.t
  const compliance = volume / (RHO * C * C)
  return [0, -1 / (w * compliance)]
}

/** Radiation impedance of the open far end. */
export function endImpedance(f: number, a: number): Cx {
  const w = 2 * Math.PI * f
  const k = w / C
  const area = Math.PI * a * a
  return [((RHO * C) / area) * 0.25 * (k * a) ** 2, ((RHO * C) / area) * 0.6 * k * a]
}

// -- the whole instrument -----------------------------------------------------

/**
 * Input impedance seen by the reed.
 *
 * A reed is a pressure-controlled valve, so it plays at the *maxima* of this —
 * the frequencies where the bore pushes back hardest.
 */
export function impedance(f: number, bore: Bore, loss = 1): Cx {
  // work backwards from the open end
  let Z = endImpedance(f, bore.a)
  let x = bore.L
  const sorted = [...bore.holes].sort((p, q) => q.x - p.x)
  for (const h of sorted) {
    if (h.x >= bore.L || h.x <= 0) continue
    const M = section(f, x - h.x, bore.a, loss)
    // propagate the load through that section
    Z = div(add(mul(M[0], Z), M[1]), add(mul(M[2], Z), M[3]))
    // then put the hole in parallel with it
    const Zh = holeImpedance(f, h)
    Z = div(mul(Z, Zh), add(Z, Zh))
    x = h.x
  }
  const M = section(f, x, bore.a, loss)
  return div(add(mul(M[0], Z), M[1]), add(mul(M[2], Z), M[3]))
}

/**
 * How much of the reed's pressure reaches the far end.
 *
 * This is where the cutoff is audible rather than merely calculable: below it
 * the open holes turn the wave around and almost nothing gets past them, above
 * it the lattice is transparent.
 */
export function transmission(f: number, bore: Bore, loss = 1): number {
  let M: Mat = [cx(1), cx(0), cx(0), cx(1)]
  let x = 0
  const sorted = [...bore.holes].filter((h) => h.x > 0 && h.x < bore.L).sort((p, q) => p.x - q.x)
  for (const h of sorted) {
    M = matmul(M, section(f, h.x - x, bore.a, loss))
    const Y = div(cx(1), holeImpedance(f, h))
    M = matmul(M, [cx(1), cx(0), Y, cx(1)])
    x = h.x
  }
  M = matmul(M, section(f, bore.L - x, bore.a, loss))
  // P_in = M11·P_end + M12·U_end, with U_end = P_end / Z_end
  const Zl = endImpedance(f, bore.a)
  const ratio = add(M[0], div(M[1], Zl))
  return 1 / Math.max(1e-12, abs(ratio))
}

/**
 * Half the trace of one lattice cell's transfer matrix — cos(Γs) for an
 * infinite periodic lattice. |·| > 1 is a stopband, where the wave dies away
 * instead of travelling; < 1 is a passband.
 *
 * For a lossless reciprocal cell this is real, and that is worth asserting
 * rather than assuming: it is the only check that the sign conventions in
 * `section` and `holeImpedance` agree with each other.
 */
export function bloch(f: number, a: number, s: number, b: number, t: number): Cx {
  const half = section(f, s / 2, a, 0)
  const Y = div(cx(1), holeImpedance(f, { x: 0, b, t, open: true }, true))
  const cell = matmul(matmul(half, [cx(1), cx(0), Y, cx(1)]), half)
  return [(cell[0][0] + cell[3][0]) / 2, (cell[0][1] + cell[3][1]) / 2]
}

/**
 * The lattice cutoff: the lowest frequency where the cell stops being
 * evanescent. Bisected on |cos(Γs)| = 1 rather than taken from a remembered
 * closed form, so it is this model's own answer.
 */
export function cutoff(a: number, s: number, b: number, t: number): number {
  const ev = (f: number) => Math.abs(bloch(f, a, s, b, t)[0]) - 1
  let lo = 20
  let hi = 20
  // walk up until we leave the stopband
  while (hi < 20000 && ev(hi) > 0) hi *= 1.08
  if (hi >= 20000) return NaN
  lo = hi / 1.08
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2
    if (ev(m) > 0) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

/** Impedance maxima — the notes the bore will play. */
export function resonances(bore: Bore, upto = 4000, loss = 1): number[] {
  const out: number[] = []
  const step = 0.5
  let prev = abs(impedance(40 - step, bore, loss))
  let cur = abs(impedance(40, bore, loss))
  for (let f = 40 + step; f <= upto; f += step) {
    const next = abs(impedance(f, bore, loss))
    if (cur > prev && cur >= next) out.push(f - step)
    prev = cur
    cur = next
  }
  return out
}

/** Build a bore: a regular lattice, optionally with per-hole irregularity. */
export function build(opts: {
  L: number
  a: number
  n: number
  first: number
  spacing: number
  b: number
  t: number
  open: number
  irregular: number
  jitter: (i: number, k: number) => number
}): Bore {
  const holes: Hole[] = []
  for (let i = 0; i < opts.n; i++) {
    const g = opts.irregular
    holes.push({
      x: opts.first + i * opts.spacing * (1 + g * 0.5 * (opts.jitter(i, 0) * 2 - 1)),
      b: opts.b * (1 + g * 0.45 * (opts.jitter(i, 1) * 2 - 1)),
      t: opts.t * (1 + g * 0.5 * (opts.jitter(i, 2) * 2 - 1)),
      // fingers come off the bell end first
      open: i >= opts.n - opts.open,
    })
  }
  return { L: opts.L, a: opts.a, holes }
}
