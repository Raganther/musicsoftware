/**
 * A stick dropped on a bar, and left there.
 *
 * `mallet` hit a bar once and measured how long the contact lasted — 1-3 ms,
 * and shorter the harder you hit, because Hertzian contact is a nonlinear
 * spring. This does not let go of the stick afterwards. A held stick bounces,
 * and the bounces do what a ball dropped on a table does: gaps shrinking
 * geometrically by the restitution, infinitely many of them, all over in
 * finite time. That is inelastic collapse, and out loud it is a buzz roll —
 * which is why a buzz *accelerates* and then stops being a roll at all.
 *
 * Except a bar is not a table. It is still ringing when the stick comes back
 * down, and a surface moving up at the moment of impact hands energy back. So
 * the textbook arithmetic holds on a dead bar and fails on a live one, and a
 * buzz lasts an order of magnitude longer on something that rings. `Bar decay`
 * is that experiment; the numbers are in the sketch's notes.
 *
 * The integration here is deliberately the same recursion as `stick.ts`, so
 * that when the harness compares them, agreeing means something.
 *
 * Plain JS, audio thread. No allocation inside process().
 */

const MAX_MODES = 16
/** Compression at which `stiffN` is quoted, so `p` changes shape and not scale. */
const C_REF = 2.5e-4
const TRACE = 512

class StickProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 6
    this.a1 = new Float64Array(MAX_MODES)
    this.a2 = new Float64Array(MAX_MODES)
    this.y1 = new Float64Array(MAX_MODES)
    this.y2 = new Float64Array(MAX_MODES)
    this.shape = new Float64Array(MAX_MODES)
    this.mmass = new Float64Array(MAX_MODES)

    // -- the stick -----------------------------------------------------------
    /** Position, metres. Negative is above the bar's rest plane. */
    this.x = -0.01
    this.v = 0
    this.mass = 0.008
    this.p = 1.5
    this.stiffN = 24
    this.k = this.stiffN / Math.pow(C_REF, this.p)
    /** How hard the hand leans in, newtons. */
    this.press = 1
    /** Optional hand strokes on top of the lean. */
    this.rate = 0
    this.lift = 0
    this.grip = 0
    this.gripDamp = 0
    this.phase = 0
    this.armed = false

    this.gain = 0.5
    /**
     * Modal displacement is a couple of hundred micrometres and audio wants
     * ±1. The only unphysical number in the file, and it is a unit conversion.
     * Set from measurement: the loudest drop the panel allows puts 3.9e-4 m
     * into the modal sum, and the sketch normalises the impulse before this.
     */
    this.outScale = 4200
    this.peak = 0
    this.rawPeak = 0

    // -- what the drawing needs ----------------------------------------------
    /** Stick height minus bar surface, decimated, so the bounces are visible. */
    this.trace = new Float32Array(TRACE)
    this.traceAt = 0
    this.decim = 0
    /** Contact bookkeeping for this drop. */
    this.inContact = false
    this.contactStart = 0
    this.samples = 0
    this.bounces = 0
    this.lastGap = 0
    this.prevEnd = -1
    this.firstGap = 0
    this.collapsedAt = -1
    this.stuck = 0
    this.lastContactMs = 0
    this.frames = 0
    /** How many times the modal state had to be rescued from NaN. Should be 0. */
    this.bad = 0

    /**
     * Modal mass must not start at zero.
     *
     * A Float64Array zero-fills, and the first `process()` runs before the
     * `modes` message arrives — so `F * shape / mmass` is 0/0, and NaN is
     * absorbing. The state never recovers, the output guard turns it into
     * silence, and every number downstream reads as a clean zero rather than
     * as an error. That is exactly what happened, and it cost a whole
     * verification run.
     */
    for (let i = 0; i < MAX_MODES; i++) {
      this.shape[i] = 0
      this.mmass[i] = 1
    }
    this.port.onmessage = (e) => this.handle(e.data)
  }

  handle(m) {
    if (m.modes) {
      this.n = Math.min(MAX_MODES, m.modes.length)
      for (let i = 0; i < this.n; i++) {
        const md = m.modes[i]
        const w = (2 * Math.PI * Math.min(md.f, sampleRate * 0.45)) / sampleRate
        const r = Math.pow(10, -3 / (Math.max(0.0004, md.t60) * sampleRate))
        this.a1[i] = 2 * r * Math.cos(w)
        this.a2[i] = -r * r
        this.shape[i] = md.shape
        this.mmass[i] = md.mmass
      }
    }
    if (m.hardness !== undefined) this.p = m.hardness
    if (m.stiff !== undefined) this.stiffN = Math.max(0.5, m.stiff)
    if (m.hardness !== undefined || m.stiff !== undefined) {
      this.k = this.stiffN / Math.pow(C_REF, this.p)
    }
    if (m.mass !== undefined) this.mass = Math.max(0.0005, m.mass)
    if (m.press !== undefined) this.press = m.press
    if (m.rate !== undefined) this.rate = m.rate
    if (m.lift !== undefined) this.lift = m.lift
    if (m.grip !== undefined) this.grip = m.grip
    if (m.gripDamp !== undefined) this.gripDamp = m.gripDamp
    if (m.gain !== undefined) this.gain = m.gain
    if (m.drop !== undefined) {
      // Start clear of the bar, moving down. Starting *in* contact would inject
      // an arbitrary force and lose the point.
      this.x = -4e-4
      this.v = m.drop
      this.inContact = false
      this.samples = 0
      this.bounces = 0
      this.prevEnd = -1
      this.firstGap = 0
      this.lastGap = 0
      this.collapsedAt = -1
      this.stuck = 0
      this.traceAt = 0
      this.trace.fill(0)
      this.armed = true
    }
    if (m.type === 'lift') {
      // pick the stick up: no press, and park it clear
      this.armed = false
      this.x = -0.01
      this.v = 0
    }
    if (m.type === 'panic') {
      this.y1.fill(0)
      this.y2.fill(0)
      this.armed = false
      this.x = -0.01
      this.v = 0
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
    const w = 2 * Math.PI * this.rate

    for (let s = 0; s < out.length; s++) {
      let y = 0
      for (let i = 0; i < n; i++) y += this.shape[i] * this.y1[i]

      let F = 0
      if (this.armed) {
        const c = this.x - y
        if (c > 0) {
          F = this.k * Math.pow(c, this.p)
          if (!this.inContact) {
            this.inContact = true
            this.contactStart = this.samples
            if (this.prevEnd >= 0) {
              const gap = (this.samples - this.prevEnd) / sr
              if (this.bounces === 0) this.firstGap = gap
              this.lastGap = gap
              this.bounces++
            }
          }
          this.stuck++
        } else if (this.inContact) {
          this.inContact = false
          this.lastContactMs = ((this.samples - this.contactStart) / sr) * 1000
          this.prevEnd = this.samples
          this.stuck = 0
        }
        // once it has been touching for 40 ms with no break, the bounces are over
        if (this.collapsedAt < 0 && this.stuck > sr * 0.04) this.collapsedAt = this.samples / sr

        const shoulder = -this.lift * (1 - Math.cos(w * (this.samples / sr))) * 0.5
        const Fg = this.press + this.grip * (shoulder - this.x) - this.gripDamp * this.v
        this.v += ((Fg - F) / this.mass) * dt
        this.x += this.v * dt
        if (this.x < -0.05) {
          this.x = -0.05
          this.v = 0
        }
        this.samples++
      }

      for (let i = 0; i < n; i++) {
        const drive = (F * this.shape[i]) / this.mmass[i]
        const o = this.a1[i] * this.y1[i] + this.a2[i] * this.y2[i] + drive * dt * dt
        this.y2[i] = this.y1[i]
        this.y1[i] = o
      }
      let mix = 0
      for (let i = 0; i < n; i++) mix += this.y1[i]
      // NaN is absorbing: once it is in the modal state it never leaves, and
      // the output guard below turns that into silence rather than into a
      // complaint. Recover, and count it, so it can never be invisible again.
      if (mix !== mix) {
        this.y1.fill(0)
        this.y2.fill(0)
        this.x = -0.01
        this.v = 0
        this.bad++
        mix = 0
      }

      // the trace is stick-minus-surface: positive is squashed, negative is airborne
      if (++this.decim >= 64) {
        this.decim = 0
        if (this.traceAt < TRACE) this.trace[this.traceAt++] = (this.x - y) * 1e4
      }

      const am = mix < 0 ? -mix : mix
      if (am > raw) raw = am
      // A runaway guard, not a saturator. It never engages on a stable model,
      // and a tanh here would make every spectrum the tanh's rather than the
      // bar's — which is the mistake `mallet` records.
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
        bounces: this.bounces,
        firstGapMs: this.firstGap * 1000,
        lastGapMs: this.lastGap * 1000,
        contactMs: this.lastContactMs,
        collapsedMs: this.collapsedAt < 0 ? -1 : this.collapsedAt * 1000,
        bad: this.bad,
        touching: this.inContact,
        trace: Array.from(this.trace.subarray(0, this.traceAt)),
      })
      this.frames = 0
      peak = 0
      raw = 0
    }
    this.peak = peak
    this.rawPeak = raw
    return true
  }
}

registerProcessor('chatter-stick', StickProcessor)
