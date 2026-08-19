/**
 * A nonlinear plate.
 *
 * A bank of two-pole resonators is a bell: you put energy in at the strike and
 * every mode decays from there, so the sound can only ever get duller. A gong
 * does the opposite — the shimmer arrives *after* the hit, a second or so
 * later, and that cannot happen in any linear model no matter how many modes
 * you give it. Energy has to move between modes, and in a real plate it does,
 * because the restoring force stops being proportional to displacement once
 * the deflection is comparable to the thickness.
 *
 * Two nonlinearities here, on very different time scales:
 *
 *   per sample   resonant triads. Where three modes satisfy f_i ~ f_j + f_k
 *                the plate's quadratic nonlinearity couples them, and energy
 *                moves between the three. Mode i is driven by q_j*q_k, and
 *                symmetrically j by q_i*q_k and k by q_i*q_j, so the transfer
 *                goes both ways and the whole set exchanges rather than one
 *                side simply gaining.
 *
 *                An earlier version fed back the square of the SUMMED
 *                displacement instead. That is much cheaper and it is the
 *                wrong mechanism: the feedback is dominated by whatever is
 *                already loudest, so it amplifies the existing distribution
 *                rather than moving energy up it. Measured, it made the plate
 *                six times duller at the attack and never bloomed.
 *
 *   per block    total energy stretches every mode frequency by the same
 *                factor — tension modulation. This is why a hard strike starts
 *                sharp and settles down as it decays.
 *
 * The loop is the dangerous part: high-Q resonators inside a feedback path
 * with a squaring nonlinearity will happily run away. Three guards, all of
 * them audible if you push past them — a tanh on the feedback, a 1/N scaling
 * so mode count does not change the loop gain, and a slow RMS watchdog that
 * pulls the feedback down if the plate starts to sing on its own.
 *
 * Plain JS, audio thread. No allocation inside process().
 */

const MAX_MODES = 64

class PlateProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 24
    this.f = new Float64Array(MAX_MODES) // mode frequency, Hz
    this.r = new Float64Array(MAX_MODES) // pole radius, from T60
    this.a1 = new Float64Array(MAX_MODES)
    this.a2 = new Float64Array(MAX_MODES)
    this.y1 = new Float64Array(MAX_MODES)
    this.y2 = new Float64Array(MAX_MODES)
    this.w = new Float64Array(MAX_MODES) // how hard the strike hits this mode
    this.pan = new Float64Array(MAX_MODES)
    /** Pending impulse, applied on the next sample. */
    this.hit = new Float64Array(MAX_MODES)

    this.couple = 0.5
    this.tension = 0.5
    this.gain = 0.5
    /** Watchdog state. */
    this.rms = 0
    this.trim = 1
    /** Resonant triads: flat [i, j, k] triples with a gain each. */
    this.tri = new Int32Array(0)
    this.triG = new Float64Array(0)
    this.nTri = 0
    /** Scratch for the coupling force on each mode. */
    this.force = new Float64Array(MAX_MODES)

    this.frames = 0
    this.peak = 0
    this.reported = 0
    this.port.onmessage = (e) => this.handle(e.data)
    for (let i = 0; i < MAX_MODES; i++) {
      this.f[i] = 200 * (1 + i)
      this.r[i] = 0.999
      this.w[i] = 0
      this.pan[i] = 0
      this.a1[i] = 0
      this.a2[i] = 0
    }
  }

  handle(m) {
    if (m.modes) {
      this.n = Math.min(MAX_MODES, m.modes.length)
      for (let i = 0; i < this.n; i++) {
        this.f[i] = m.modes[i].f
        this.r[i] = m.modes[i].r
        this.pan[i] = m.modes[i].pan
        // How strongly the nonlinear return path drives this mode. In a real
        // plate the coupling grows with mode order, which is the reason the
        // cascade runs upward rather than just smearing.
        this.w[i] = m.modes[i].w
      }
      this.recalc(1)
    }
    if (m.tri) {
      this.nTri = m.tri.length / 3
      this.tri = Int32Array.from(m.tri)
      this.triG = Float64Array.from(m.triG)
    }
    if (m.couple !== undefined) this.couple = m.couple
    if (m.tension !== undefined) this.tension = m.tension
    if (m.gain !== undefined) this.gain = m.gain
    if (m.strike) {
      for (let i = 0; i < this.n; i++) this.hit[i] += m.strike[i]
    }
    if (m.type === 'panic') {
      this.y1.fill(0)
      this.y2.fill(0)
      this.hit.fill(0)
      this.trim = 1
      this.rms = 0
      this.force.fill(0)
    }
  }

  /** Resonator coefficients, with every mode stretched by `stretch`. */
  recalc(stretch) {
    const sr = sampleRate
    for (let i = 0; i < this.n; i++) {
      let w = (2 * Math.PI * this.f[i] * stretch) / sr
      if (w > 3.0) w = 3.0 // keep well below Nyquist; a folded mode is a whistle
      this.a1[i] = 2 * this.r[i] * Math.cos(w)
      this.a2[i] = -this.r[i] * this.r[i]
    }
  }

  process(_inputs, outputs) {
    const L = outputs[0][0]
    const R = outputs[0][1] ?? outputs[0][0]
    if (!L) return true
    const n = this.n
    const N = L.length

    // -- per block: tension modulation ---------------------------------------
    // Energy stretches the plate, so every mode goes sharp together. Slow
    // enough that once per block is indistinguishable from once per sample,
    // and it saves N cosines per sample.
    const stretch = 1 + this.tension * 0.06 * Math.min(1, this.rms * 6)
    this.recalc(stretch)

    // Scaled by the triad count so adding modes enriches the plate instead of
    // changing how hard it is driven.
    const beta = this.nTri > 0 ? (this.couple * 160) / this.nTri : 0
    const norm = 1 / Math.sqrt(n)
    let peak = this.peak
    let acc = 0

    for (let s = 0; s < N; s++) {
      // sum the plate's displacement
      let y = 0
      let yl = 0
      let yr = 0
      for (let i = 0; i < n; i++) {
        const v = this.y1[i]
        y += v
        const p = this.pan[i]
        yl += v * (1 - p) * 0.5
        yr += v * (1 + p) * 0.5
        this.force[i] = 0
      }

      // -- resonant triads ---------------------------------------------------
      // Each triple exchanges energy three ways. This is the whole instrument;
      // with beta at zero it is a bank of independent resonators and nothing
      // can move between them.
      if (beta > 0) {
        const tri = this.tri
        const tg = this.triG
        for (let t = 0, o = 0; t < this.nTri; t++, o += 3) {
          const i = tri[o]
          const j = tri[o + 1]
          const k = tri[o + 2]
          const g = tg[t] * beta
          const qi = this.y1[i]
          const qj = this.y1[j]
          const qk = this.y1[k]
          this.force[i] += g * qj * qk
          this.force[j] += g * qi * qk
          this.force[k] += g * qi * qj
        }
      }

      for (let i = 0; i < n; i++) {
        // A quadratic term can run away in one sample; bound the force rather
        // than letting a single loud triad take the plate with it.
        let f = this.force[i] * this.trim
        if (f > 0.35) f = 0.35
        else if (f < -0.35) f = -0.35
        const inp = this.hit[i] + f
        this.hit[i] = 0
        const out = this.a1[i] * this.y1[i] + this.a2[i] * this.y2[i] + inp
        this.y2[i] = this.y1[i]
        this.y1[i] = out
      }

      // Normalise the sum. Forty-eight modes at a plausible amplitude each
      // add up to something around ten, which pins the output tanh and turns
      // the instrument into a fuzz box — measured as a peak stuck at exactly
      // the master gain no matter what any parameter did. Incoherent partials
      // sum as sqrt(n).
      const gl = Math.tanh(yl * norm * this.gain)
      const gr = Math.tanh(yr * norm * this.gain)
      L[s] = gl
      R[s] = gr
      const a = gl < 0 ? -gl : gl
      if (a > peak) peak = a
      acc += y * y
    }

    // -- watchdog -------------------------------------------------------------
    // A squaring nonlinearity inside a resonant loop can sustain itself. If the
    // plate is not decaying, pull the feedback down until it does; recover
    // slowly so a legitimate long tail is not squashed.
    const blockRms = Math.sqrt(acc / N)
    this.rms = this.rms * 0.9 + blockRms * 0.1
    if (this.rms > 1.4) this.trim *= 0.9
    else if (this.trim < 1) this.trim = Math.min(1, this.trim * 1.002)

    this.frames += N
    if (this.frames >= sampleRate / 30) {
      this.port.postMessage({ peak, rms: this.rms, trim: this.trim })
      this.frames = 0
      peak = 0
    }
    this.peak = peak
    return true
  }
}

registerProcessor('nonlinear-plate', PlateProcessor)
