/**
 * A mallet hitting a bar, integrated properly.
 *
 * Almost every physical model in this repo — and most elsewhere — spends its
 * effort on the resonator and excites it with a canned impulse. That gets the
 * pitch right and the dynamics wrong, because a struck bar hit harder is not
 * the same sound louder. It is a different sound: the harder you hit, the
 * *less* time the mallet spends in contact, and a shorter contact puts energy
 * into higher modes.
 *
 * The reason is that a mallet is a nonlinear spring. Two curved elastic bodies
 * in contact obey Hertz's law, F = k·c^p with p = 3/2, and for any p ≠ 1 the
 * contact time depends on how fast you arrive:
 *
 *     t_contact  ∝  v^((1-p)/(1+p))
 *
 * At p = 3/2 that is v^(-1/5) — a hard strike is in contact for less time. And
 * at p = 1, a linear spring, the exponent is zero: contact time is completely
 * independent of velocity, which is the classic result for a mass on a spring.
 * So `hardness` at 1 should give a bar that gets louder and not brighter, and
 * anything above 1 should give both. That is the whole experiment.
 *
 * The coupling is the Chaigne–Askenfelt arrangement: the bar's surface
 * displacement under the mallet is the sum of its modes weighted by their
 * shapes there, the compression is mallet-minus-surface, and the contact force
 * drives both the mallet (backwards) and every mode (weighted by that same
 * shape). Nothing here is an impulse.
 *
 * Plain JS, audio thread. No allocation inside process().
 */

const MAX_MODES = 24

class HammerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 8
    this.a1 = new Float64Array(MAX_MODES)
    this.a2 = new Float64Array(MAX_MODES)
    this.y1 = new Float64Array(MAX_MODES)
    this.y2 = new Float64Array(MAX_MODES)
    /** Mode shape at the strike point — how strongly the contact drives it. */
    this.shape = new Float64Array(MAX_MODES)
    /** Modal mass: higher modes take more force to move. */
    this.mmass = new Float64Array(MAX_MODES)

    // -- the mallet ----------------------------------------------------------
    /** Position, metres. Negative is above the bar. */
    this.x = -1
    this.v = 0
    this.mass = 0.008
    /** Hertz exponent. 1 is a linear spring; 3/2 is two curved elastic bodies. */
    this.p = 1.5
    /**
     * Stiffness is given as the force it takes to squash the head by C_REF, not
     * as a raw k. It has to be, because k in F = k·c^p carries units of N/m^p —
     * the *same* k means a wildly different mallet at p = 1 and p = 3, and the
     * first version of this file was 100x quieter at p = 3 for that reason
     * alone. Anchoring the force at one compression makes `hardness` change the
     * shape of the force curve and nothing else, which is the entire experiment.
     */
    this.C_REF = 2.5e-4
    this.stiffN = 24
    this.k = this.stiffN / Math.pow(this.C_REF, this.p)
    this.inContact = false

    this.gain = 0.5
    /**
     * Modal displacement for a real bar struck with a real mallet is on the
     * order of tens of nanometres, and the model works in metres because the
     * contact law does. Audio wants +-1. This is the only unphysical number in
     * the file and it is a unit conversion, not a fudge — without it the whole
     * thing computes correctly and outputs silence, which is exactly what it
     * did first time.
     */
    this.outScale = 3.6e5
    this.peak = 0
    /**
     * Peak of the *un*scaled modal sum, in metres. Reported so the level can be
     * checked against the saturation instead of guessed at — a `tanh` that is
     * clipping still reports a healthy-looking peak, which is exactly how this
     * sketch's first brightness measurement came out meaningless.
     */
    this.rawPeak = 0
    /** Peak of the scaled output before the runaway clamp. */
    this.drivePeak = 0
    this.frames = 0
    /** Reported back so the drawing can show the contact, not guess at it. */
    this.lastContact = 0
    this.lastForce = 0
    this.contactSamples = 0
    this.forceScope = new Float32Array(256)
    this.scopeAt = 0
    this.scopeArmed = false

    for (let i = 0; i < MAX_MODES; i++) {
      this.a1[i] = 0
      this.a2[i] = 0
      this.shape[i] = 0
      this.mmass[i] = 1
    }
    this.port.onmessage = (e) => this.handle(e.data)
  }

  handle(m) {
    if (m.modes) {
      this.n = Math.min(MAX_MODES, m.modes.length)
      const sr = sampleRate
      for (let i = 0; i < this.n; i++) {
        const md = m.modes[i]
        const w = (2 * Math.PI * Math.min(md.f, sr * 0.45)) / sr
        const r = Math.pow(10, -3 / (Math.max(0.02, md.t60) * sr))
        this.a1[i] = 2 * r * Math.cos(w)
        this.a2[i] = -r * r
        this.shape[i] = md.shape
        this.mmass[i] = md.mmass
      }
    }
    if (m.hardness !== undefined) this.p = m.hardness
    if (m.stiff !== undefined) this.stiffN = Math.max(0.5, m.stiff)
    if (m.hardness !== undefined || m.stiff !== undefined) {
      this.k = this.stiffN / Math.pow(this.C_REF, this.p)
    }
    if (m.mass !== undefined) this.mass = Math.max(0.0005, m.mass)
    if (m.gain !== undefined) this.gain = m.gain
    if (m.strike !== undefined) {
      // Start just clear of the bar, moving down. Starting *in* contact would
      // inject an arbitrary force and lose the whole point.
      this.x = -0.0004
      this.v = m.strike
      this.inContact = false
      this.contactSamples = 0
      this.lastForce = 0
      this.scopeAt = 0
      this.scopeArmed = true
      this.forceScope.fill(0)
    }
    if (m.type === 'panic') {
      this.y1.fill(0)
      this.y2.fill(0)
      this.v = 0
      this.x = -1
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const n = this.n
    const sr = sampleRate
    const dt = 1 / sr
    let peak = this.peak
    let raw = this.rawPeak
    let drive = this.drivePeak

    for (let s = 0; s < out.length; s++) {
      // where the bar's surface is, under the mallet
      let y = 0
      for (let i = 0; i < n; i++) y += this.shape[i] * this.y1[i]

      // -- contact ------------------------------------------------------------
      let F = 0
      const c = this.x - y
      if (c > 0 && this.v > -1e4) {
        F = this.k * Math.pow(c, this.p)
        if (!this.inContact) {
          this.inContact = true
          this.contactSamples = 0
        }
        this.contactSamples++
      } else if (this.inContact) {
        this.inContact = false
        this.lastContact = (this.contactSamples / sr) * 1000
        this.scopeArmed = false
      }

      // peak force *of this strike*, held until the next one — resetting it per
      // report just made the readout flash to zero between notes
      if (F > this.lastForce) this.lastForce = F
      if (this.scopeArmed && this.scopeAt < this.forceScope.length) {
        this.forceScope[this.scopeAt++] = F
      }

      // mallet: the force pushes it back out
      this.v -= (F / this.mass) * dt
      this.x += this.v * dt
      // once it has left, park it clear so it cannot re-strike
      if (this.x < -0.01) {
        this.x = -1
        this.v = 0
      }

      // -- the bar -------------------------------------------------------------
      let mix = 0
      for (let i = 0; i < n; i++) {
        const drive = (F * this.shape[i]) / this.mmass[i]
        const o = this.a1[i] * this.y1[i] + this.a2[i] * this.y2[i] + drive * dt * dt
        this.y2[i] = this.y1[i]
        this.y1[i] = o
        mix += o
      }

      const am = mix < 0 ? -mix : mix
      if (am > raw) raw = am
      const d = am * this.outScale * this.gain
      if (d > drive) drive = d

      // No tanh here. A soft-clipper in the sketch is a second saturator in
      // front of the master limiter, and this one silently ate the first
      // brightness measurement — every spectrum was the tanh's harmonics, not
      // the bar's modes. The clamp is a runaway guard set far above any real
      // signal: it stops an unstable model poisoning the graph with NaN, and
      // it never engages otherwise.
      const g = mix * this.outScale * this.gain
      const q = g > 2 ? 2 : g < -2 ? -2 : g
      out[s] = q === q ? q : 0
      const a = q < 0 ? -q : q
      if (a > peak) peak = a
    }

    this.frames += out.length
    if (this.frames >= sampleRate / 30) {
      this.port.postMessage({
        peak,
        raw,
        drive,
        contactMs: this.lastContact,
        force: this.lastForce,
        scope: Array.from(this.forceScope.subarray(0, 200)),
      })
      this.frames = 0
      peak = 0
      raw = 0
      drive = 0
    }
    this.peak = peak
    this.rawPeak = raw
    this.drivePeak = drive
    return true
  }
}

registerProcessor('mallet-hammer', HammerProcessor)
