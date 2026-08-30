/**
 * A string mode coupled to a body resonance — the wolf note.
 *
 * Every cellist knows the wolf: somewhere around F or F# on the G string the
 * note stops sustaining and starts stuttering, and moving a quarter-tone either
 * way cures it. The cause is not the string and not the body but the coupling
 * between them, and it is the most ordinary phenomenon in physics — two
 * oscillators that share energy.
 *
 * Two coupled modes obey
 *
 *     ÿ₁ + ω₁²y₁ = κ(b − y₁)
 *     b̈  + ω_b²b  = κ(y₁ − b)
 *
 * whose normal modes are the eigenvalues of [[ω₁²+κ, −κ], [−κ, ω_b²+κ]]:
 *
 *     λ± = (ω₁² + ω_b²)/2 + κ ± √( ((ω₁² − ω_b²)/2)² + κ² )
 *
 * The square root can never vanish while κ > 0, so as the string is tuned
 * through the body resonance the two frequencies **repel rather than cross**.
 * That is an avoided crossing, and it is the whole content of the wolf: at the
 * closest approach the string is not one note but two, a few Hz apart, and
 * what you hear as stuttering is them beating.
 *
 * Only mode 1 is coupled. A body resonance is narrow and the upper partials
 * pass it by, which is also why the wolf is a property of one note rather than
 * of the instrument's whole range.
 *
 * Plain JS, audio thread. No allocation inside process().
 */

const MAX_MODES = 16

class WolfProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 6
    this.a1 = new Float64Array(MAX_MODES)
    this.a2 = new Float64Array(MAX_MODES)
    this.y1 = new Float64Array(MAX_MODES)
    this.y2 = new Float64Array(MAX_MODES)
    this.amp = new Float64Array(MAX_MODES)

    // the body: one resonance, and the reason for all of this
    this.b1 = 0
    this.b2 = 0
    this.ba1 = 0
    this.ba2 = 0
    /** Coupling, in rad²/s². Zero is the control: the modes cross freely. */
    this.kappa = 0

    /**
     * Bow: a negative resistance on mode 1 that pumps energy in until the
     * amplitude reaches `sat`, which is the crudest possible stand-in for
     * stick-slip and enough to sustain. With the bow off the string is plucked
     * and the two modes simply ring and beat, which is the cleaner experiment.
     */
    this.bow = 0
    /**
     * Where the bow stops pushing. Arbitrary, and chosen by measurement rather
     * than by physics: a sustained bow drives every partial at once and so runs
     * far hotter than a decaying pluck, and at 0.35 the bowed sketch peaked at
     * 0.98 pre-limiter while the plucked default sat at 0.49.
     */
    this.sat = 0.22

    this.gain = 0.5
    this.peak = 0
    /** Peak of the unscaled sum, so a runaway is visible as a number. */
    this.rawPeak = 0
    this.frames = 0
    /** Energy in each half of the pair, reported so the sloshing is visible. */
    this.eString = 0
    this.eBody = 0

    this.port.onmessage = (e) => this.handle(e.data)
  }

  /** Second-order resonator coefficients for frequency f and decay t60. */
  coef(f, t60) {
    const sr = sampleRate
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr
    const r = Math.pow(10, -3 / (Math.max(0.02, t60) * sr))
    return [2 * r * Math.cos(w), -r * r]
  }

  handle(m) {
    if (m.modes) {
      this.n = Math.min(MAX_MODES, m.modes.length)
      for (let i = 0; i < this.n; i++) {
        const [a1, a2] = this.coef(m.modes[i].f, m.modes[i].t60)
        this.a1[i] = a1
        this.a2[i] = a2
        this.amp[i] = m.modes[i].amp
      }
    }
    if (m.body) {
      const [a1, a2] = this.coef(m.body.f, m.body.t60)
      this.ba1 = a1
      this.ba2 = a2
    }
    if (m.kappa !== undefined) this.kappa = m.kappa
    if (m.bow !== undefined) this.bow = m.bow
    if (m.gain !== undefined) this.gain = m.gain
    if (m.pluck !== undefined) {
      /**
       * Both history samples, not just the newest.
       *
       * Setting y1 alone leaves y1 − y2 equal to the whole pluck in one sample,
       * which is not a displacement but an enormous velocity: the amplitude
       * comes out a/ω_n, and at 98 Hz ω_n is 0.0128 rad/sample, so asking for
       * 0.6 got about 47 — roughly 80x too big, and the output sat on its clamp
       * in every configuration. Setting both is a displacement released from
       * rest, which is what a pluck is.
       *
       * Energy goes into the string only — the body is never struck directly,
       * which is what makes the sloshing between them readable.
       *
       * `hold` is the fraction of the previous note left on the string. A
       * finger landing for the next note stops most of what is there, so
       * plucking into a ringing string is not addition: at hold = 0.5 repeated
       * plucks converge on 2a however long the ring is set, where straight
       * addition let a long ring and a fast scale stack without bound. The body
       * is deliberately *not* damped here — it keeps sounding after the string
       * is stopped, which is true of a cello and is half of why the wolf's
       * energy sloshes back.
       */
      const hold = m.hold === undefined ? 0.5 : m.hold
      for (let i = 0; i < this.n; i++) {
        const a = m.pluck * this.amp[i]
        this.y1[i] = this.y1[i] * hold + a
        this.y2[i] = this.y2[i] * hold + a
      }
    }
    if (m.type === 'panic') {
      this.y1.fill(0)
      this.y2.fill(0)
      this.b1 = 0
      this.b2 = 0
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const n = this.n
    const dt = 1 / sampleRate
    const kdt = this.kappa * dt * dt
    let peak = this.peak
    let raw = this.rawPeak

    for (let s = 0; s < out.length; s++) {
      // -- mode 1 and the body, the only pair that talks ----------------------
      const y = this.y1[0]
      const b = this.b1
      const toString = kdt * (b - y)
      const toBody = kdt * (y - b)

      // the bow, pumping mode 1 until it saturates
      let drive = 0
      if (this.bow > 0) {
        const a = y < 0 ? -y : y
        drive = this.bow * (this.y1[0] - this.y2[0]) * (1 - a / this.sat)
      }

      let mix = 0
      for (let i = 0; i < n; i++) {
        const o =
          this.a1[i] * this.y1[i] + this.a2[i] * this.y2[i] + (i === 0 ? toString + drive : 0)
        this.y2[i] = this.y1[i]
        this.y1[i] = o
        mix += o
      }
      const bo = this.ba1 * this.b1 + this.ba2 * this.b2 + toBody
      this.b2 = this.b1
      this.b1 = bo

      // The body radiates: it is the part of a cello you actually hear, so it
      // is mixed in rather than being a hidden load on the string.
      const sum = mix + bo * 2.2
      const asum = sum < 0 ? -sum : sum
      if (asum > raw) raw = asum
      const g = sum * this.gain
      // A runaway guard, not a waveshaper — it must never engage in normal
      // playing, and `rawPeak` above exists so that "it engaged" is a visible
      // number rather than a mystery. `mallet` put a tanh here and it quietly
      // became the thing setting the level; a hard clamp at least announces
      // itself, which is how the velocity-pluck bug was caught (every
      // configuration reading exactly 2 x the master gain).
      const q = g > 2 ? 2 : g < -2 ? -2 : g
      out[s] = q === q ? q : 0
      const av = q < 0 ? -q : q
      if (av > peak) peak = av
    }

    // energies, for the drawing
    this.eString = this.y1[0] * this.y1[0]
    this.eBody = this.b1 * this.b1

    this.frames += out.length
    if (this.frames >= sampleRate / 30) {
      this.port.postMessage({ peak, raw, eString: this.eString, eBody: this.eBody })
      this.frames = 0
      peak = 0
      raw = 0
    }
    this.peak = peak
    this.rawPeak = raw
    return true
  }
}

registerProcessor('wolf-string', WolfProcessor)
