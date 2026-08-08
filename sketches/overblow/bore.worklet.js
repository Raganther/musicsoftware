/**
 * A single-reed wind instrument: nonlinear reed coupled to a bore.
 *
 * The bore is one delay line carrying the whole round trip, with an inverting
 * reflection at the open end. That makes it a quarter-wave resonator — it
 * resonates at ODD multiples of sr/2N and nothing else — which is what a
 * clarinet is and why its low register sounds hollow.
 *
 * The reed is Smith's: a memoryless table mapping the pressure difference
 * across the reed to a reflection coefficient, clipped where the reed slams
 * shut against the lay. The attack transient, the harmonics and the squeaks
 * all come out of that one nonlinearity sitting in a feedback loop.
 *
 * The register vent is a *hole at a position*, not a filter. A resistive leak
 * at fraction p of the bore bleeds energy out of every mode that has pressure
 * there and leaves alone any mode with a node at p. Mode k has nodes at
 * x = L(2n+1)/k, so a hole a third of the way along spares mode 3 and spoils
 * modes 1 and 5 — the clarinet's twelfth. Putting it at a fifth of the way
 * along spares mode 5 instead. That is the whole register key, in two lines.
 *
 * Plain JS, audio thread. No allocation and no logging inside process().
 */

class BoreProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    /** Longest bore: down to ~35 Hz needs sr/70 samples one way. */
    this.cap = Math.ceil(sampleRate / 35) + 8
    this.buf = new Float32Array(this.cap)
    this.w = 0

    this.len = 300 // round-trip delay in samples (fractional)
    this.target = 300
    this.glide = 0.0016 // per-sample approach rate

    this.loss = 0.985
    this.bright = 0.55
    this.lp = 0

    this.offset = 0.7 // reed table: where it sits at rest
    this.slope = -0.44 // reed table: stiffness (negative)

    this.pressure = 0 // target breath
    this.breath = 0 // smoothed breath
    this.atk = 0.0016
    this.rel = 0.0012
    this.noise = 0.04

    this.pos = 1 / 3 // vent position, as a fraction of the bore
    this.vent = 0 // target leak
    this.leak = 0 // smoothed leak

    this.dcx = 0
    this.dcy = 0
    this.gain = 0.5
    this.rs = 22222

    /** Peak since the last post, for the drawing. */
    this.peak = 0
    this.frames = 0

    this.port.onmessage = (e) => this.handle(e.data)
  }

  handle(m) {
    if (m.freq !== undefined) {
      // Inverting far end: the round trip is half a period, so a bore of
      // sr/2f samples sounds f.
      this.target = Math.max(8, Math.min(this.cap - 4, sampleRate / (2 * m.freq)))
      if (m.jump) this.len = this.target
    }
    if (m.pressure !== undefined) this.pressure = m.pressure
    if (m.loss !== undefined) this.loss = m.loss
    if (m.bright !== undefined) this.bright = m.bright
    if (m.offset !== undefined) this.offset = m.offset
    if (m.slope !== undefined) this.slope = m.slope
    if (m.noise !== undefined) this.noise = m.noise
    if (m.pos !== undefined) this.pos = m.pos
    if (m.vent !== undefined) this.vent = m.vent
    if (m.glide !== undefined) this.glide = m.glide
    if (m.rs !== undefined) this.rs = (m.rs | 0) || 22222
    if (m.gain !== undefined) this.gain = m.gain
    if (m.type === 'panic') {
      this.buf.fill(0)
      this.breath = 0
      this.pressure = 0
      this.lp = 0
    }
  }

  rand() {
    this.rs ^= this.rs << 13
    this.rs ^= this.rs >>> 17
    this.rs ^= this.rs << 5
    return (this.rs >>> 0) / 4294967296
  }

  read(delay) {
    let rp = this.w - delay
    while (rp < 0) rp += this.cap
    const i = Math.floor(rp)
    const f = rp - i
    const a = this.buf[i]
    const b = this.buf[i + 1 >= this.cap ? 0 : i + 1]
    return a + (b - a) * f
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true

    const aLp = 0.12 + this.bright * 0.82
    let peak = this.peak

    for (let i = 0; i < out.length; i++) {
      if (this.len !== this.target) {
        this.len += (this.target - this.len) * this.glide
        if (Math.abs(this.target - this.len) < 1e-4) this.len = this.target
      }
      const k = this.pressure > this.breath ? this.atk : this.rel
      this.breath += (this.pressure - this.breath) * k
      this.leak += (this.vent - this.leak) * 0.0025

      let b = this.breath
      if (this.noise > 0) b += b * this.noise * (this.rand() * 2 - 1)

      let x = this.read(this.len)

      // the bell: high frequencies radiate away rather than reflecting
      this.lp += (x - this.lp) * aLp
      x = this.lp

      const refl = -this.loss * x

      // Smith's reed: the pressure difference across it sets a reflection
      // coefficient, clipped where the reed closes.
      const dp = refl - b
      let r = this.offset + this.slope * dp
      if (r > 1) r = 1
      else if (r < -1) r = -1

      const inject = b + dp * r
      this.buf[this.w] = inject
      this.w = this.w + 1 >= this.cap ? 0 : this.w + 1

      // The vent. A hole shunts the *pressure* at its position, and pressure
      // is the sum of the two travelling waves there — outbound at delay
      // p·len/2, inbound at len minus that. The line stores the inbound wave
      // before its end reflection, so its physical sign is flipped and the
      // local pressure is the difference of the two taps.
      //
      // That difference is what makes this mode-selective: a mode with a node
      // at the hole has no pressure there, so nothing is taken from it.
      // Attenuating the two taps directly instead (which is what I tried
      // first) scales both travelling waves regardless of the standing wave
      // and just damps everything equally.
      if (this.leak > 1e-4) {
        const d1 = Math.round(this.pos * this.len * 0.5)
        let i1 = this.w - d1
        if (i1 < 0) i1 += this.cap
        let i2 = this.w - (Math.round(this.len) - d1)
        while (i2 < 0) i2 += this.cap
        const a1 = this.buf[i1]
        const c1 = this.buf[i2]
        const bleed = 0.5 * this.leak * (a1 - c1)
        this.buf[i1] = a1 - bleed
        this.buf[i2] = c1 + bleed
      }

      // DC blocker: the reed table has an offset and the loop gain is high.
      const d = inject - this.dcx + 0.9975 * this.dcy
      this.dcx = inject
      this.dcy = d

      const s = Math.tanh(d * 1.6) * this.gain
      out[i] = s
      const a = s < 0 ? -s : s
      if (a > peak) peak = a
    }

    // The drawing has to follow the sound and the main thread cannot see
    // inside the loop, so post the envelope ~50 times a second.
    this.frames += out.length
    if (this.frames >= sampleRate / 50) {
      this.port.postMessage({ peak, leak: this.leak })
      this.frames = 0
      peak = 0
    }
    this.peak = peak
    return true
  }
}

registerProcessor('bore', BoreProcessor)
