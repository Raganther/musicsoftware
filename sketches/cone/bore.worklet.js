/**
 * A reed on a bore that can be a cone or a cylinder, or anything between.
 *
 * `overblow` built the cylinder here on 2026-08-08 and measured its register
 * break at a twelfth — 2.98 against a predicted 3. A cone should overblow at
 * the *octave* instead, which is the difference between a clarinet and a
 * saxophone, and `ideas.md` has carried a note since then that the cheap way of
 * getting one (flipping the far-end reflection in a waveguide) does not
 * oscillate at all. A cone is not a sign flip.
 *
 * So the bore is modal rather than a waveguide, and the modes come from the
 * actual boundary conditions. Pressure in a cone goes as p = (A/r)sin(kr + φ);
 * a pressure release at the open end and zero flow at the truncated apex give
 *
 *     kL + arctan(k·r0) = nπ
 *
 * which is a transcendental equation with two limits worth knowing:
 * r0 → 0 is a complete cone and kL = nπ, a full harmonic series; r0 → ∞ is a
 * cylinder and kL = (n − ½)π, odd harmonics only. Everything in between is a
 * real truncated cone, which is what an actual saxophone is.
 *
 * The mode frequencies are therefore *derived*, not imposed — but what the reed
 * does with them is not derived at all. Which mode it locks onto, and what it
 * jumps to when you blow harder, is the nonlinear dynamics deciding, and that
 * is the part worth measuring.
 *
 * The reed is the standard pressure-controlled valve: it closes as the pressure
 * across it rises, and the flow through the remaining gap follows Bernoulli. No
 * reed mass — a static characteristic is enough to sustain, and leaving the
 * dynamics out means the register break cannot be an artefact of reed tuning.
 *
 * Plain JS, audio thread. No allocation inside process().
 */

const MAX_MODES = 24

class BoreProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 12
    this.a1 = new Float64Array(MAX_MODES)
    this.a2 = new Float64Array(MAX_MODES)
    this.y1 = new Float64Array(MAX_MODES)
    this.y2 = new Float64Array(MAX_MODES)
    this.g = new Float64Array(MAX_MODES)

    this.mouth = 0
    /** Pressure at which the reed slams shut. */
    this.pClose = 1
    this.reedW = 0.4
    this.noise = 0.004
    this.gain = 0.3
    this.rs = 22222
    this.u1 = 0
    this.u2 = 0
    this.peak = 0
    this.frames = 0
    this.port.onmessage = (e) => this.handle(e.data)
  }

  rnd() {
    let x = this.rs
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rs = x | 0
    return this.rs / 2147483648
  }

  handle(m) {
    if (m.modes) {
      this.n = Math.min(MAX_MODES, m.modes.length)
      for (let i = 0; i < this.n; i++) {
        const { f, t60, t60ref, g } = m.modes[i]
        const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate
        const r = Math.pow(10, -3 / (Math.max(0.004, t60) * sampleRate))
        const a1 = 2 * r * Math.cos(w)
        const a2 = -r * r
        this.a1[i] = a1
        this.a2[i] = a2
        /**
         * Normalised so each mode peaks at `g`, with the (1 − z⁻²) numerator
         * that makes this a bandpass rather than a two-pole lowpass.
         *
         * That numerator is not cosmetic. An all-pole resonator lags 90° at its
         * own resonance, so the sum of them has zero phase *between* the modes
         * rather than on them — and a reed closing that loop duly oscillated at
         * 1.3 to 1.8 times the first mode instead of on it, at every truncation
         * and at every blowing pressure. A bore's input impedance is real at a
         * resonance; the model has to be too.
         */
        /**
         * Normalised against a *reference* damping, not the actual one.
         *
         * Normalising each mode to unit peak using its own damping silently
         * cancels the damping: a mode spoiled to a sixty-seventh of its Q comes
         * back out at exactly the same height, and the register vent — which
         * works by spoiling the first resonance — became a no-op that changed
         * nothing at any truncation. A mode's peak input impedance is
         * proportional to its Q, so the reference has to be fixed and the
         * damping allowed to move the peak.
         */
        const rRef = Math.pow(10, -3 / (Math.max(0.004, t60ref ?? t60) * sampleRate))
        const b1 = 2 * rRef * Math.cos(w)
        const b2 = -rRef * rRef
        const dRe = 1 - b1 * Math.cos(w) - b2 * Math.cos(2 * w)
        const dIm = b1 * Math.sin(w) + b2 * Math.sin(2 * w)
        const peakRef = (2 * Math.abs(Math.sin(w))) / Math.max(1e-9, Math.hypot(dRe, dIm))
        this.g[i] = g / Math.max(1e-9, peakRef)
      }
    }
    if (m.mouth !== undefined) this.mouth = m.mouth
    if (m.pClose !== undefined) this.pClose = Math.max(0.05, m.pClose)
    if (m.reedW !== undefined) this.reedW = m.reedW
    if (m.noise !== undefined) this.noise = m.noise
    if (m.gain !== undefined) this.gain = m.gain
    if (m.seed !== undefined) this.rs = (Math.round(m.seed) * 2654435761) | 0 || 22222
    if (m.type === 'panic') {
      this.y1.fill(0)
      this.y2.fill(0)
      this.u1 = 0
      this.u2 = 0
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const n = this.n
    let peak = this.peak

    for (let s = 0; s < out.length; s++) {
      // Bore pressure at the mouthpiece is the sum of the modes.
      let p = 0
      for (let i = 0; i < n; i++) p += this.y1[i]

      // -- the reed ----------------------------------------------------------
      const dp = this.mouth - p
      // Opening: fully open with no pressure across it, shut at pClose. The
      // reed cannot un-shut by being blown backwards, hence the clamp at 0.
      let open = 1 - dp / this.pClose
      if (open < 0) open = 0
      else if (open > 1) open = 1
      // Bernoulli: flow goes as the square root of the pressure drop, signed.
      const adp = dp < 0 ? -dp : dp
      const u = this.reedW * open * Math.sign(dp) * Math.sqrt(adp) +
        this.noise * open * this.rnd()

      // -- the bore ----------------------------------------------------------
      const du = u - this.u2
      this.u2 = this.u1
      this.u1 = u
      for (let i = 0; i < n; i++) {
        const o = this.a1[i] * this.y1[i] + this.a2[i] * this.y2[i] + this.g[i] * du
        this.y2[i] = this.y1[i]
        this.y1[i] = o
      }

      const y = p * this.gain
      const q = y > 1.5 ? 1.5 : y < -1.5 ? -1.5 : y
      out[s] = q === q ? q : 0
      const av = q < 0 ? -q : q
      if (av > peak) peak = av
    }

    this.frames += out.length
    if (this.frames >= sampleRate / 30) {
      this.port.postMessage({ peak })
      this.frames = 0
      peak = 0
    }
    this.peak = peak
    return true
  }
}

registerProcessor('cone-bore', BoreProcessor)
