/**
 * A stiff string, and why a piano has several different right answers for the
 * same octave.
 *
 * Every string in this repo — `aeolian-harp`, `bow`, `wolf` — is ideal: its
 * partials are exact multiples of the fundamental, because an ideal string
 * restores only through tension. A real wire also resists *bending*, and that
 * term stiffens the short wavelengths, so partial `n` sits at
 *
 *     f_n = n·f₀·√(1 + B·n²)
 *
 * with `B` the inharmonicity coefficient. The partials are **stretched**, and
 * the higher you go the further out they are.
 *
 * That is the whole reason a piano is tuned the way it is, and the reason it
 * cannot be tuned exactly. Tuning an octave means making a partial of the lower
 * note beat-free against a partial of the upper. Which pair you choose is a
 * decision, and with stretched partials the choices **disagree**: the 2:1
 * octave wants one width and the 4:2 octave wants a wider one. Both are
 * correct. A tuner picks.
 *
 * No imports: run directly under `node --experimental-strip-types`.
 */

/** Frequency of partial `n` (1-based) of a stiff string. */
export function partial(f0: number, B: number, n: number): number {
  return n * f0 * Math.sqrt(1 + B * n * n)
}

/**
 * How far partial `n` sits above where an ideal string would put it, in cents.
 * Zero at B = 0 for every n, and growing as n² for small B.
 */
export function partialCents(B: number, n: number): number {
  return 1200 * Math.log2(Math.sqrt(1 + B * n * n))
}

/**
 * Amplitude of partial `n` when the string is struck at `x` along its length.
 *
 * `sin(nπx)`, so striking at `m/n` puts a node of partial `n` under the hammer
 * and the partial is **exactly** absent. Stiffness stretches the frequencies
 * and leaves the mode shapes nearly sinusoidal, so it does not move the nulls.
 */
export function strikeComb(x: number, n: number): number {
  return Math.abs(Math.sin(n * Math.PI * x))
}

/**
 * The width, in cents, of a beat-free `2k:k` octave between two stiff strings.
 *
 * Partial `2k` of the lower note is matched against partial `k` of the upper.
 * `k = 1` is the 2:1 octave a beginner tunes, `k = 2` the 4:2 octave a tuner
 * uses in the middle, `k = 3` the 6:3. At B = 0 every one of them is exactly
 * 1200.
 */
export function octaveCents(bLow: number, bHigh: number, k = 1): number {
  const lower = 2 * k * Math.sqrt(1 + bLow * 4 * k * k)
  const upper = k * Math.sqrt(1 + bHigh * k * k)
  return 1200 * Math.log2(lower / upper)
}

/** Beat rate in Hz between partial `2k` of the lower string and partial `k` of the upper. */
export function beatRate(f0Low: number, bLow: number, f0High: number, bHigh: number, k = 1): number {
  return Math.abs(partial(f0Low, bLow, 2 * k) - partial(f0High, bHigh, k))
}

/**
 * The inharmonicity coefficient from the wire itself:
 * `B = π³·E·d⁴ / (64·L²·T)`, with `E` Young's modulus (Pa), `d` the diameter
 * (m), `L` the speaking length (m) and `T` the tension (N).
 *
 * The useful part is the scaling, not the constant: `B ∝ d⁴/(L²T)`, so a short
 * thick string is far more inharmonic than a long thin one — which is why the
 * stretch is worst at the ends of the keyboard and least in the middle.
 */
export function coefficient(d: number, L: number, T: number, E = 2e11): number {
  return (Math.pow(Math.PI, 3) * E * Math.pow(d, 4)) / (64 * L * L * T)
}

export type OctaveType = 1 | 2 | 3 | 4

/**
 * Tune a run of octaves by chaining one octave type, and report where each note
 * lands against equal temperament.
 *
 * Chaining *any single* type is always possible — each step is just a
 * multiplication. The impossibility is that the types disagree, so the same
 * keyboard tuned 2:1 and tuned 4:2 is two different instruments.
 */
export function chain(bs: number[], k: OctaveType, f0 = 32.7): number[] {
  const out = [f0]
  for (let i = 1; i < bs.length; i++) {
    const c = octaveCents(bs[i - 1], bs[i], k)
    out.push(out[i - 1] * Math.pow(2, c / 1200))
  }
  return out
}

/** Cents between two frequencies. */
export const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

/**
 * The disagreement between octave types over a run of octaves, in cents — how
 * far apart the top note ends up depending only on which partial pair the tuner
 * listened to.
 */
export function spread(bs: number[], types: OctaveType[] = [1, 2, 4]): { tops: number[]; worst: number } {
  const tops = types.map((k) => chain(bs, k)[bs.length - 1])
  let worst = 0
  for (const a of tops) for (const b of tops) worst = Math.max(worst, Math.abs(cents(a, b)))
  return { tops, worst }
}

/**
 * Decay time of partial `n`, in seconds. Higher partials lose energy faster —
 * air and internal damping both rise with frequency — which is most of why a
 * piano note goes from bright to pure as it rings.
 */
export function partialDecay(base: number, n: number, rolloff = 0.7): number {
  return base / Math.pow(n, rolloff)
}
