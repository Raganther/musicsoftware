/**
 * A bank of pulse trains, one per voice, at exact integer ratios.
 *
 * Each voice is a phasor. Every time it wraps it strikes a damped sine at its
 * own formant frequency — a "ping". Nothing else. The point is that this one
 * generator does not care whether it is running at 2 Hz or 200: at the bottom
 * of its range the pings are separate events and you hear a polyrhythm, and at
 * the top they fuse and you hear a chord whose pitches are those same ratios.
 *
 * That is why the base rate is the only thing the slider moves. If the sketch
 * switched generators anywhere along the way the demonstration would be worth
 * nothing.
 *
 * Plain JS, audio thread. No allocation and no logging inside process().
 */

const MAX = 8

class PulseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 3
    /** Base rate in Hz; voice i runs at base * ratio[i]. */
    this.base = 4
    this.ratios = new Float64Array(MAX)
    this.formants = new Float64Array(MAX)
    this.phase = new Float64Array(MAX)
    /** Ping state: envelope and its own oscillator phase. */
    this.env = new Float64Array(MAX)
    this.pp = new Float64Array(MAX)
    this.pan = new Float64Array(MAX)
    for (let i = 0; i < MAX; i++) {
      this.ratios[i] = 1 + i
      this.formants[i] = 900 * Math.pow(1.7, i)
      this.pan[i] = 0
    }
    /** Ping decay, seconds. */
    this.width = 0.012
    this.gain = 0.5
    this.strikes = new Int32Array(MAX)
    this.peak = 0
    this.frames = 0
    this.port.onmessage = (e) => this.handle(e.data)
  }

  handle(m) {
    if (m.ratios) {
      this.n = Math.min(MAX, m.ratios.length)
      for (let i = 0; i < this.n; i++) this.ratios[i] = m.ratios[i]
    }
    if (m.phases) for (let i = 0; i < this.n; i++) this.phase[i] = m.phases[i] % 1
    if (m.formants) for (let i = 0; i < this.n; i++) this.formants[i] = m.formants[i]
    if (m.pans) for (let i = 0; i < this.n; i++) this.pan[i] = m.pans[i]
    if (m.base !== undefined) this.base = Math.max(0.05, m.base)
    if (m.width !== undefined) this.width = Math.max(0.0004, m.width)
    if (m.gain !== undefined) this.gain = m.gain
    if (m.type === 'reset' || m.type === 'panic') {
      this.phase.fill(0)
      this.env.fill(0)
      this.pp.fill(0)
      if (m.type === 'panic') this.gain = 0
    }
  }

  process(_inputs, outputs) {
    const L = outputs[0][0]
    const R = outputs[0][1] ?? outputs[0][0]
    if (!L) return true
    const sr = sampleRate
    // envelope decay per sample, from the ping width
    const dec = Math.exp(-1 / (this.width * sr))
    let peak = this.peak

    for (let s = 0; s < L.length; s++) {
      let l = 0
      let r = 0
      for (let i = 0; i < this.n; i++) {
        const f = this.base * this.ratios[i]
        this.phase[i] += f / sr
        if (this.phase[i] >= 1) {
          this.phase[i] -= 1
          // strike: restart the ping, phase-aligned so every hit is identical
          this.env[i] = 1
          this.pp[i] = 0
          this.strikes[i]++
        }
        if (this.env[i] > 1e-5) {
          this.pp[i] += this.formants[i] / sr
          if (this.pp[i] > 1) this.pp[i] -= 1
          const v = this.env[i] * Math.sin(this.pp[i] * Math.PI * 2)
          this.env[i] *= dec
          const p = this.pan[i]
          l += v * (1 - p) * 0.5
          r += v * (1 + p) * 0.5
        }
      }
      l = Math.tanh(l * this.gain)
      r = Math.tanh(r * this.gain)
      L[s] = l
      R[s] = r
      const a = l < 0 ? -l : l
      if (a > peak) peak = a
    }

    this.frames += L.length
    if (this.frames >= sampleRate / 30) {
      this.port.postMessage({ peak, strikes: Array.from(this.strikes.subarray(0, this.n)) })
      this.frames = 0
      peak = 0
    }
    this.peak = peak
    return true
  }
}

registerProcessor('pulse-bank', PulseProcessor)
