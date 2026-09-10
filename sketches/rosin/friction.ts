/**
 * The same bowed string as `string.worklet.js`, on the main thread.
 *
 * It exists so the Schelleng diagram can be *this model's* rather than the
 * textbook's drawn on top of it. `bow` drew the wedge as an overlay and said
 * so honestly, because its physics did not produce one; the point of this
 * sketch is that the region on screen is measured, and measuring it needs a
 * hundred short simulations, which is milliseconds here and a stall if it goes
 * through an OfflineAudioContext.
 *
 * A worklet cannot import, so this is a deliberate second copy. The harness
 * compares the two on the quantity the diagram is made of — releases per
 * period — so a divergence shows up as a number rather than as a picture that
 * is quietly wrong.
 */

export interface Bowing {
  f0: number
  /** Bow position as a fraction of the string from the bridge. */
  beta: number
  force: number
  speed: number
  /** Static coefficient as a multiple of the dynamic one. 1 closes the loop. */
  muS: number
  damp: number
  loss: number
}

export interface Regime {
  /** Releases per period. Helmholtz motion is exactly 1. */
  slipsPerPeriod: number
  /** Fraction of the time the string is being dragged by the bow. */
  stuckFraction: number
  /** How much that release count wanders across the analysis window. */
  spread: number
  rms: number
}

/**
 * Run the string for `secs` and report what regime it settled into.
 *
 * The bow speed ramps in over the first fifth rather than starting as a step:
 * which regime a string finds depends on the attack, which is a real fact
 * about bowing and not a numerical convenience.
 */
export function simulate(b: Bowing, sr: number, secs = 1.0): Regime {
  const P = sr / Math.max(20, b.f0)
  const beta = Math.min(0.48, Math.max(0.008, b.beta))

  // Fractional delays, interpolated, exactly as the worklet does them.
  // Rounding these to whole samples instead makes a string of a different
  // length bowed at a different fraction — 22/245 rather than 0.09 — and the
  // two copies then disagree about which regime the string is in, which was
  // measured before it was assumed.
  const SIZE = 8192
  // Float32, because that is what an AudioWorklet's delay lines are. Running
  // the same algorithm at double precision is a different simulation once the
  // dynamics are this sensitive.
  const bufB = new Float32Array(SIZE)
  const bufN = new Float32Array(SIZE)
  let wB = 0
  let wN = 0
  const lenB = Math.max(2, Math.min(SIZE - 4, P * beta))
  const lenN = Math.max(2, Math.min(SIZE - 4, P * (1 - beta)))
  const read = (buf: Float32Array, w: number, len: number) => {
    const q = w - len + SIZE
    const i = Math.floor(q)
    const f = q - i
    const x = buf[i % SIZE]
    const y = buf[(i + 1) % SIZE]
    return x + (y - x) * f
  }

  let lp = 0
  let stuck = true
  const c = Math.min(0.98, Math.max(0, b.damp))
  const loss = Math.min(1, b.loss)
  const muD = 1
  const muS = Math.max(1, b.muS)
  const F = b.force

  const n = Math.round(sr * secs)
  const ramp = Math.round(n * 0.2)
  const from = Math.floor(n * 0.6)
  let slips = 0
  let stuckN = 0
  let sum = 0
  const quarters = [0, 0, 0, 0]

  for (let i = 0; i < n; i++) {
    // k-rate, in 128-sample blocks, because an AudioParam ramp is a staircase
    // at the block boundary and the attack decides which regime is found.
    const blk = i - (i % 128)
    const vBow = b.speed * Math.min(1, blk / Math.max(1, ramp))
    const a = read(bufB, wB, lenB)
    const bb = read(bufN, wN, lenN)
    const dv = vBow - (a + bb)
    let f
    if (stuck) {
      if (Math.abs(dv) <= muS * F) f = dv
      else {
        stuck = false
        if (i >= from) {
          slips++
          quarters[Math.min(3, Math.floor(((i - from) * 4) / (n - from)))]++
        }
        f = muD * F * Math.sign(dv)
      }
    } else {
      if (Math.abs(dv) <= muD * F) {
        stuck = true
        f = dv
      } else f = muD * F * Math.sign(dv)
    }
    if (i >= from && stuck) stuckN++

    const toNut = a + f
    const toBridge = bb + f
    bufN[wN] = -toNut * loss
    lp = (1 - c) * -toBridge + c * lp
    bufB[wB] = lp * loss
    wB = (wB + 1) % SIZE
    wN = (wN + 1) % SIZE

    if (i >= from) sum += toBridge * toBridge
  }

  const len = n - from
  const periods = len / P
  const q = quarters.map((v) => (v * 4) / periods)
  return {
    slipsPerPeriod: slips / periods,
    stuckFraction: stuckN / len,
    spread: Math.max(...q) - Math.min(...q),
    rms: Math.sqrt(sum / len),
  }
}

/**
 * Helmholtz motion: exactly one release per period, steadily, with a real
 * stick phase. The last clause matters — one release per period with almost no
 * sticking is the string being dragged, and it showed up as isolated cells in
 * the middle of the region where nothing speaks.
 */
export function isHelmholtz(r: Regime): boolean {
  return (
    Number.isFinite(r.slipsPerPeriod) &&
    Math.abs(r.slipsPerPeriod - 1) < 0.12 &&
    r.spread < 0.3 &&
    r.stuckFraction > 0.25 &&
    r.rms > 1e-4
  )
}

/** −1 below the region, 0 inside it, +1 above: surface, speaking, crushed. */
export function classify(r: Regime): number {
  if (isHelmholtz(r)) return 0
  return r.slipsPerPeriod < 0.9 ? -1 : 1
}
