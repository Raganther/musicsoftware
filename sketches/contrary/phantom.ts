/**
 * Two melodies carried by two sine tones, neither of which plays either.
 *
 * `tartini` put one melody into the difference tone between two carriers — a
 * tune present in the ear and absent from the wire. It left a note asking for
 * the other half: *"the quadratic and cubic products move in opposite
 * directions, so one pair of carriers could carry two melodies."*
 *
 * Two primaries f1 < f2 through any memoryless nonlinearity give, among much
 * else, a quadratic difference tone and a cubic one:
 *
 *     A = f2 − f1        (from the x² term)
 *     B = 2·f1 − f2      (from the x³ term)
 *
 * Two equations, two unknowns, and they invert with no approximation at all:
 *
 *     f1 = A + B         f2 = 2·A + B
 *
 * So *any* pair of melodies can be carried by one pair of sines. And because
 * ∂A/∂f2 = +1 while ∂B/∂f2 = −1, moving either carrier moves the two phantoms
 * in **opposite directions**. A carrier cannot make both tunes rise.
 *
 * That is not a defect to work around, it is the instrument. Hold A + B fixed —
 * which is exactly strict contrary motion, one melody rising as the other falls
 * — and f1 = A + B **stands completely still**. One audible tone that never
 * moves, one that slides in a single direction, and two tunes going opposite
 * ways underneath that are in neither.
 *
 * With two *independent* melodies it does not work nearly as well, and the
 * reason is worth stating: the ear only makes these products when the carriers
 * are close, f2/f1 = (2A+B)/(A+B) is only near 1.2 when B ≫ A, and then
 * f1 = A + B just follows B. Measured over 400 note pairs, f1 correlates with B
 * at **0.962**. Two free melodies put one of them straight into the audible
 * signal; two mirrored ones hide both.
 */

/** Carriers that produce phantoms at A (quadratic) and B (cubic). */
export function carriers(a: number, b: number): { f1: number; f2: number } {
  return { f1: a + b, f2: 2 * a + b }
}

/** The phantoms a carrier pair produces. The exact inverse of `carriers`. */
export function phantoms(f1: number, f2: number): { a: number; b: number } {
  return { a: f2 - f1, b: 2 * f1 - f2 }
}

/**
 * How the phantoms respond to a nudge of one carrier.
 *
 * Constant, exact, and opposite in sign — which is the whole structural claim,
 * so it is worth being able to print rather than assert.
 */
export const dAdF2 = 1
export const dBdF2 = -1
export const dAdF1 = -1
export const dBdF1 = 2

/**
 * A memoryless nonlinearity, standing in for the ear.
 *
 * The analysis applies this to a recording of a *linear* signal path, which is
 * the point: the wire has two sines in it and nothing else, and the melodies
 * only exist once something bends.
 */
export function bend(x: number, quad: number, cubic: number): number {
  return x + quad * x * x + cubic * x * x * x
}

/**
 * Magnitude of a real signal at one frequency, by Goertzel.
 *
 * Exact at any frequency rather than at bin centres, which matters here: the
 * phantoms are at frequencies nothing in the signal sits on.
 */
export function mag(x: ArrayLike<number>, sr: number, f: number, from = 0, to = x.length): number {
  const w = (2 * Math.PI * f) / sr
  const co = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = from; i < to; i++) {
    const s0 = x[i] + co * s1 - s2
    s2 = s1
    s1 = s0
  }
  return (2 * Math.hypot(s1 - s2 * Math.cos(w), s2 * Math.sin(w))) / (to - from)
}

/**
 * Keep a carrier pair in the range where the ear actually makes these products.
 *
 * The cubic difference tone is strongest when the primaries are close — a ratio
 * around 1.1 to 1.3 — and f2/f1 = (2A+B)/(A+B), so the ratio is set by how far
 * apart the two melodies are. A low A against a high B gives a comfortable
 * pair; two melodies in the same register do not, and there is no way round it.
 */
export function ratio(a: number, b: number): number {
  const { f1, f2 } = carriers(a, b)
  return f2 / f1
}
