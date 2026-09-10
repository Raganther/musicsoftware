/**
 * A bowed string with a real stick-slip state machine.
 *
 * `bow` (2026-08-13) built the waveguide and found Schelleng's force wedge was
 * not in it: "a memoryless characteristic reproduces Helmholtz motion happily
 * and the force boundaries not at all". The reason it gave is the one to test —
 * a memoryless friction curve has no static-versus-dynamic distinction and so
 * nothing to tear loose from, and Schelleng's minimum force comes out of the
 * hysteresis of rosin.
 *
 * So this is the same waveguide with the friction replaced by two thresholds
 * rather than one curve:
 *
 *   stuck, and |Δv| ≤ μs·F   → stay stuck, the bow drags the string exactly
 *   stuck, and |Δv| > μs·F   → break away
 *   slipping, |Δv| > μd·F    → keep slipping at the dynamic force
 *   slipping, |Δv| ≤ μd·F    → get captured
 *
 * Breaking away takes μs·F and being captured again takes only μd·F, so the
 * loop encloses area: that is the hysteresis, and μs/μd is the one knob that
 * turns it off. At μs = μd the two thresholds coincide, the loop closes to a
 * line, and the model becomes the memoryless one — which makes the control for
 * the whole experiment a single parameter rather than a second build.
 *
 * Parameters arrive as AudioParams rather than through the port. That is not a
 * style choice: an OfflineAudioContext runs its whole render before a
 * postMessage is delivered, so a harness that sweeps by posting gets every
 * configuration at the constructor defaults — a grid of identical numbers,
 * which is exactly what it looked like. The friction state goes out on a
 * second output channel for the same reason: the analysis has to be able to
 * read it without the port being involved at all.
 *
 * Velocity waves, 2Z normalised to 1, so the force needed to hold the string at
 * the bow's velocity is numerically the relative velocity it would otherwise
 * have. The bow splits the string into a bridge-side loop of β·(sr/f0) samples
 * and a nut-side loop of (1−β)·(sr/f0), which sum to the period as they must.
 */

const MAXD = 8192

class Frac {
  constructor() {
    this.buf = new Float32Array(MAXD)
    this.w = 0
    this.len = 100
  }
  setLen(v) {
    this.len = Math.max(2, Math.min(MAXD - 4, v))
  }
  read() {
    const p = this.w - this.len + MAXD
    const i = Math.floor(p)
    const f = p - i
    const a = this.buf[i % MAXD]
    const b = this.buf[(i + 1) % MAXD]
    return a + (b - a) * f
  }
  write(v) {
    this.buf[this.w] = v
    this.w = (this.w + 1) % MAXD
  }
  clear() {
    this.buf.fill(0)
  }
}

class RosinString extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' })
    return [
      k('f0', 196, 20, 4000),
      k('beta', 0.12, 0.008, 0.48),
      k('force', 0.06, 0, 8),
      k('speed', 0.12, -1, 1),
      k('muS', 1.6, 1, 6),
      k('damp', 0.35, 0, 0.98),
      // Loss per pass. Schelleng's minimum force is a statement about how much
      // the Helmholtz corner is rounded on its way round, so this is not a
      // tuning constant — it is one of the things the boundary depends on.
      k('loss', 0.9992, 0.99, 1),
      k('gain', 1, 0, 8),
      k('on', 1, 0, 1),
    ]
  }

  constructor() {
    super()
    this.db = new Frac() // bridge side: bow → bridge → bow
    this.dn = new Frac() // nut side:    bow → nut → bow
    this.stuck = true
    this.lp = 0 // bridge lowpass state
    this.dc1 = 0 // DC blocker
    this.dc2 = 0

    // what the analysis reads
    this.slips = 0
    this.frames = 0
    this.peak = 0
    this.stuckSamples = 0

    this.retune(196, 0.12)
    this.port.onmessage = (e) => {
      const m = e.data
      if (m === 'reset' || m.type === 'reset') {
        this.db.clear()
        this.dn.clear()
        this.lp = 0
        this.dc1 = 0
        this.dc2 = 0
        this.stuck = true
        this.slips = 0
        this.stuckSamples = 0
        this.frames = 0
        return
      }
    }
  }

  retune(f0, beta) {
    const P = sampleRate / Math.max(20, f0)
    const b = Math.min(0.48, Math.max(0.008, beta))
    this.db.setLen(P * b)
    this.dn.setLen(P * (1 - b))
    this.period = P
  }

  process(_inputs, outputs, parameters) {
    const out = outputs[0][0]
    /** Channel 1 carries the friction state, so slips can be counted exactly
     *  from a render rather than inferred from the sound. */
    const state = outputs[0][1]
    const n = out.length
    const p = (k) => parameters[k][0]
    this.retune(p('f0'), p('beta'))
    const c = Math.min(0.98, Math.max(0, p('damp')))
    const loss = Math.min(1, p('loss'))
    const muD = 1
    const muS = Math.max(1, p('muS'))
    const vBow = p('on') > 0.5 ? p('speed') : 0
    const F = p('force')
    const gain = p('gain')

    for (let i = 0; i < n; i++) {
      const a = this.db.read() // arriving from the bridge
      const b = this.dn.read() // arriving from the nut
      const vin = a + b
      const dv = vBow - vin

      let f
      if (this.stuck) {
        if (Math.abs(dv) <= muS * F) {
          f = dv
        } else {
          this.stuck = false
          this.slips++
          f = muD * F * Math.sign(dv)
        }
      } else {
        if (Math.abs(dv) <= muD * F) {
          this.stuck = true
          f = dv
        } else {
          f = muD * F * Math.sign(dv)
        }
      }
      if (this.stuck) this.stuckSamples++

      // 2Z = 1, so the injected velocity is the force itself. The string is
      // continuous here: a wave arriving *from* the bridge is travelling
      // toward the nut and carries on to the nut. Sending it back the way it
      // came makes the two segments independent resonators that never exchange
      // energy, and no Helmholtz corner can go round.
      const toNut = a + f
      const toBridge = b + f

      // nut: rigid, sign inverted
      this.dn.write(-toNut * loss)
      // bridge: inverted, lossy, and lowpassed — the rounding of the Helmholtz
      // corner that Schelleng's minimum force is a statement about
      this.lp = (1 - c) * (-toBridge) + c * this.lp
      this.db.write(this.lp * loss)

      // the bridge-side travelling wave is what radiates; block its DC, which
      // the bow's steady velocity would otherwise pile up
      const x = toBridge
      const y = x - this.dc1 + 0.9985 * this.dc2
      this.dc1 = x
      this.dc2 = y

      let v = y * gain
      if (!(v === v)) v = 0
      if (v > 1.6) v = 1.6
      else if (v < -1.6) v = -1.6
      out[i] = v
      if (state) state[i] = this.stuck ? 1 : 0
      const av = v < 0 ? -v : v
      if (av > this.peak) this.peak = av
    }

    this.frames += n
    if (this.frames >= sampleRate / 20) {
      this.port.postMessage({
        peak: this.peak,
        // The number that matters: Helmholtz motion is exactly one release per
        // period, and it is an integer, so a broken detector cannot be subtly
        // wrong about it.
        slipsPerPeriod: this.slips / (this.frames / this.period),
        stuckFraction: this.stuckSamples / this.frames,
      })
      this.peak = 0
      this.slips = 0
      this.stuckSamples = 0
      this.frames = 0
    }
    return true
  }
}

registerProcessor('rosin-string', RosinString)
