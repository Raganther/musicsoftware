import { rng } from '@core'

/**
 * A room, and enough spectrum analysis to watch what it does.
 *
 * Lucier's process is a multiplication: play a recording into a room, record
 * the result, and the new recording's spectrum is the old one times |H(f)|.
 * Do it N times and you have |X₀(f)|·|H(f)|^N, so the ratio between any two
 * frequencies is raised to the Nth power. Whatever the room's single best
 * frequency is wins by an exponentially growing margin, and everything else
 * leaves. Speech becomes a tone, and the tone is a measurement of the room.
 *
 * The prediction worth testing is what happens to the *width* of what is left.
 * Near its top a resonance is locally quadratic, so |H|^N ≈ H_max^N·exp(−Na·δ²)
 * — a Gaussian whose width falls as N^(−1/2). A Lorentzian gives the same
 * exponent by a different route, so −1/2 does not depend on the shape of the
 * peak, only on it having one.
 */

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/** In-place radix-2 FFT. `re`/`im` must be a power of two long. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/**
 * Welch magnitude spectrum: Hann-windowed frames, half-overlapped, averaged in
 * power. Averaging matters here — a single frame of a decaying signal is far
 * noisier than the thing being measured.
 */
export function spectrum(
  x: Float32Array | Float64Array,
  size = 4096,
  /**
   * Set for an impulse response. A Hann window is *zero at t = 0*, which is
   * exactly where an impulse response keeps its energy — windowing one deletes
   * every short-ringing mode and leaves only the diffuse tail, which spreads
   * across the whole window and survives. That inverted the answer to which
   * frequency this room prefers, and it took a control to notice. An IR
   * already decays to nothing, so it needs no window; only a short fade at the
   * end, to avoid a step where the recording stops.
   */
  impulse = false,
): Float64Array {
  const half = size >> 1
  const out = new Float64Array(half)
  const re = new Float64Array(size)
  const im = new Float64Array(size)

  // A frequency resolution of sr/size is a floor on every width this can
  // report, and the whole question here is how narrow a peak gets. So when the
  // transform is longer than the signal, use the signal *whole*, windowed and
  // zero-padded — one frame at the best resolution its duration allows —
  // rather than averaging short frames that cannot see the answer.
  if (size >= x.length) {
    const n = x.length
    const tail = Math.max(1, Math.round(n * 0.05))
    for (let i = 0; i < n; i++) {
      const w = impulse
        ? i > n - tail
          ? 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / tail)
          : 1
        : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
      re[i] = x[i] * w
    }
    fft(re, im)
    for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i])
    return out
  }

  const win = new Float64Array(size)
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  let frames = 0
  for (let off = 0; off + size <= x.length; off += half) {
    for (let i = 0; i < size; i++) {
      re[i] = x[off + i] * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let i = 0; i < half; i++) out[i] += re[i] * re[i] + im[i] * im[i]
    frames++
  }
  if (frames === 0) return out
  for (let i = 0; i < half; i++) out[i] = Math.sqrt(out[i] / frames)
  return out
}

/**
 * The −3 dB width of the tallest peak, in Hz, by walking out from the maximum
 * and interpolating the crossing. Returns the centre too, since which frequency
 * survives is half the question.
 */
export function peakWidth(
  mag: Float64Array,
  binHz: number,
  fromBin = 4,
  toBin = mag.length - 1,
): { hz: number; width: number; bin: number } {
  const hiB = Math.min(toBin, mag.length - 1)
  let top = fromBin
  for (let i = fromBin; i <= hiB; i++) if (mag[i] > mag[top]) top = i
  const target = mag[top] / Math.SQRT2
  const cross = (dir: number) => {
    let i = top
    while (i + dir > fromBin && i + dir < hiB && mag[i + dir] > target) i += dir
    const a = mag[i]
    const b = mag[i + dir]
    // linear interpolation onto the crossing, in bins
    const frac = a === b ? 0 : (a - target) / (a - b)
    return i + dir * frac
  }
  return { hz: top * binHz, width: Math.abs(cross(1) - cross(-1)) * binHz, bin: top }
}

/**
 * A moving average across `hz` of bandwidth.
 *
 * This is not cosmetic. A recording of duration T has spectral detail at the
 * 1/T scale everywhere — 0.38 Hz here — so the −3 dB width of the raw argmax
 * measures that fine structure and comes out at about one bin no matter what
 * the room did. What |H|^N shapes is the *envelope*: multiplying by a
 * resonance re-weights the envelope and leaves the fine structure where it
 * was. Smooth over a band well above 1/T and well below the resonance, and
 * the envelope is what is left to measure.
 */
export function smooth(mag: Float64Array, binHz: number, hz: number): Float64Array {
  const half = Math.max(1, Math.round(hz / 2 / binHz))
  const out = new Float64Array(mag.length)
  let acc = 0
  for (let i = 0; i <= half && i < mag.length; i++) acc += mag[i]
  let lo = 0
  let hi = Math.min(half, mag.length - 1)
  for (let i = 0; i < mag.length; i++) {
    out[i] = acc / (hi - lo + 1)
    if (i - half >= 0) { acc -= mag[i - half]; lo++ }
    if (i + half + 1 < mag.length) { acc += mag[i + half + 1]; hi++ }
  }
  return out
}

// ---------------------------------------------------------------------------
// the room
// ---------------------------------------------------------------------------

/**
 * An impulse response: a diffuse exponential noise tail with a handful of
 * resonances sitting in it.
 *
 * The noise matters. A room made only of the modes I chose would make the
 * winner a foregone conclusion, and the interesting question — which frequency
 * survives — would be answered by construction. With a dense random tail the
 * modes have to actually beat the loudest accidental peak, and sometimes they
 * do not.
 */
export function makeIR(
  sampleRate: number,
  seconds: number,
  seed: number,
  nModes: number,
  /** t60 of the resonances, in seconds — which *is* their linewidth: 2.2/t60 Hz. */
  ring: number,
  /**
   * How much diffuse tail sits under the modes. It is not decoration: the
   * largest of ~100k noise bins is around five standard deviations, so a mode
   * has to beat an extreme value rather than an average, and at a diffuse
   * level of 1 the winner of the whole process is a noise spike that nobody
   * put there.
   */
  diffuse = 0.15,
): Float32Array {
  const n = Math.max(1, Math.round(seconds * sampleRate))
  const out = new Float32Array(n)
  const r = rng(seed)
  // diffuse tail
  const tau = seconds / 3
  for (let i = 0; i < n; i++) {
    out[i] = diffuse * (r.next() * 2 - 1) * Math.exp(-i / (tau * sampleRate))
  }
  // resonances, low and closely spaced the way a small room's are
  for (let m = 0; m < nModes; m++) {
    const f = 90 + r.next() ** 1.7 * 900
    const t60 = Math.max(0.02, ring * (0.6 + r.next() * 0.8))
    // A decaying sinusoid carries energy proportional to a^2*t60, so without
    // this the modes fade into the diffuse tail as soon as the ring is short —
    // and the ring is exactly the thing being varied.
    const a = (0.55 + r.next() * 0.45) * Math.sqrt(0.4 / t60)
    const ph = r.next() * Math.PI * 2
    const k = Math.log(1000) / (t60 * sampleRate)
    for (let i = 0; i < n; i++) {
      out[i] += a * Math.sin((2 * Math.PI * f * i) / sampleRate + ph) * Math.exp(-k * i)
    }
  }
  // a short fade in, so the IR does not begin with a step
  const fade = Math.min(64, n)
  for (let i = 0; i < fade; i++) out[i] *= i / fade
  let e = 0
  for (let i = 0; i < n; i++) e += out[i] * out[i]
  const g = e > 0 ? 1 / Math.sqrt(e) : 1
  for (let i = 0; i < n; i++) out[i] *= g
  return out
}

/** Normalise to a given peak, in place. Lucier had a gain knob too. */
export function normalise(x: Float32Array, to = 0.9): Float32Array {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  if (p > 0) {
    const g = to / p
    for (let i = 0; i < x.length; i++) x[i] *= g
  }
  return x
}
