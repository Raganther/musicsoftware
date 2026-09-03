/**
 * Feedback as an instrument.
 *
 * A microphone pointed at its own loudspeaker howls at one particular pitch,
 * and which pitch is not arbitrary. Energy goes round a loop of delay D and
 * filter H, and a frequency can only survive if it comes back in phase with
 * itself and no quieter than it left:
 *
 *     |g · H(f)| ≥ 1          and          2π·f·D/sr − ∠H(f) = 2πn
 *
 * The phase condition is the interesting half. It admits only a *comb* of
 * frequencies — one per integer n — so the loop cannot sing at whatever pitch
 * you like. Sweep the delay and the pitch slides down as n·sr/D, then jumps to
 * the next tooth. The filter decides which tooth wins.
 *
 * That gives three things to check against the sound rather than assert:
 *
 *   - the sounding frequency, put back through f·D/sr − ∠H(f)/2π, must come out
 *     an **integer**
 *   - within one tooth, f·D is constant, so the pitch falls as 1/D and the
 *     jumps land where the arithmetic says
 *   - it starts howling at loop gain **1/|H(f_n)|**, not at 1 — because the
 *     surviving mode is generally not sitting exactly on the filter's peak, and
 *     how far off it is depends on the delay
 *
 * The last one is the least obvious and the best test: the threshold should
 * scallop up and down as the comb slides under the filter.
 *
 * The saturator is what makes it an instrument rather than an explosion: once
 * the loop is above unity the amplitude grows until tanh compresses the
 * effective gain back to exactly 1, which is where it sits.
 *
 * Plain JS, audio thread. No allocation inside process().
 */

const MAX_VOICES = 6
/** 250 ms at 48 kHz, which is longer than any delay the panel offers. */
const MAX_DELAY = 12288

class LarsenProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.n = 3
    this.bufs = []
    this.wi = new Int32Array(MAX_VOICES)
    this.dly = new Int32Array(MAX_VOICES)
    this.x1 = new Float64Array(MAX_VOICES)
    this.x2 = new Float64Array(MAX_VOICES)
    this.y1 = new Float64Array(MAX_VOICES)
    this.y2 = new Float64Array(MAX_VOICES)
    this.exc = new Float64Array(MAX_VOICES)
    for (let i = 0; i < MAX_VOICES; i++) {
      this.bufs.push(new Float64Array(MAX_DELAY))
      this.dly[i] = 1000
    }

    // RBJ bandpass, constant 0 dB peak. Unity gain and zero phase at f0, which
    // is what makes the phase condition tractable in closed form.
    this.b0 = 1
    this.b1 = 0
    this.b2 = 0
    this.a1 = 0
    this.a2 = 0
    this.f0 = 440
    this.q = 4
    this.setFilter(440, 4)

    this.gain = 0.9
    this.drive = 3
    this.out = 0.3
    /** Seeded noise state for the excitation burst. */
    this.rs = 12345
    this.peak = 0
    this.frames = 0
    this.port.onmessage = (e) => this.handle(e.data)
  }

  setFilter(f0, q) {
    this.f0 = f0
    this.q = Math.max(0.3, q)
    const w0 = (2 * Math.PI * Math.min(f0, sampleRate * 0.45)) / sampleRate
    const alpha = Math.sin(w0) / (2 * this.q)
    const a0 = 1 + alpha
    this.b0 = alpha / a0
    this.b1 = 0
    this.b2 = -alpha / a0
    this.a1 = (-2 * Math.cos(w0)) / a0
    this.a2 = (1 - alpha) / a0
  }

  rnd() {
    // xorshift, so the excitation is reproducible from the sketch's seed
    let x = this.rs
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rs = x | 0
    return (this.rs / 2147483648) % 1
  }

  handle(m) {
    if (m.seed !== undefined) this.rs = (Math.round(m.seed) * 2654435761) | 0 || 12345
    if (m.voices !== undefined) this.n = Math.max(1, Math.min(MAX_VOICES, Math.round(m.voices)))
    if (m.delays) {
      for (let i = 0; i < m.delays.length && i < MAX_VOICES; i++) {
        // Integer samples, deliberately: the phase condition is exact in
        // samples, and 1/48000 s of resolution is finer than the panel can ask
        // for anyway. The actual integer is reported back so the harness tests
        // the delay the loop really has, not the one the slider requested.
        this.dly[i] = Math.max(2, Math.min(MAX_DELAY - 2, Math.round((m.delays[i] * sampleRate) / 1000)))
      }
    }
    if (m.f0 !== undefined || m.q !== undefined) {
      this.setFilter(m.f0 ?? this.f0, m.q ?? this.q)
    }
    if (m.gain !== undefined) this.gain = m.gain
    if (m.drive !== undefined) this.drive = Math.max(0.2, m.drive)
    if (m.out !== undefined) this.out = m.out
    if (m.excite !== undefined) {
      for (let i = 0; i < this.n; i++) this.exc[i] = m.excite
    }
    if (m.type === 'panic') {
      for (let i = 0; i < MAX_VOICES; i++) {
        this.bufs[i].fill(0)
        this.x1[i] = this.x2[i] = this.y1[i] = this.y2[i] = this.exc[i] = 0
      }
    }
    if (m.type === 'report') {
      this.port.postMessage({
        type: 'state',
        sr: sampleRate,
        delays: Array.from(this.dly.slice(0, this.n)),
        f0: this.f0,
        q: this.q,
        gain: this.gain,
        coeffs: [this.b0, this.b1, this.b2, this.a1, this.a2],
      })
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const n = this.n
    // 40 ms of excitation decay: long enough to get the loop going, short
    // enough that what you hear afterwards is the loop and not the burst.
    const excDecay = Math.exp(-1 / (0.04 * sampleRate))
    let peak = this.peak

    for (let s = 0; s < out.length; s++) {
      let mix = 0
      for (let v = 0; v < n; v++) {
        const buf = this.bufs[v]
        const len = buf.length
        const wi = this.wi[v]
        let ri = wi - this.dly[v]
        if (ri < 0) ri += len
        const x0 = buf[ri]

        const y =
          this.b0 * x0 + this.b1 * this.x1[v] + this.b2 * this.x2[v] -
          this.a1 * this.y1[v] - this.a2 * this.y2[v]
        this.x2[v] = this.x1[v]
        this.x1[v] = x0
        this.y2[v] = this.y1[v]
        this.y1[v] = y

        // Above unity the amplitude climbs until tanh pulls the effective gain
        // back to exactly 1. That equilibrium is the instrument.
        const d = this.drive
        let z = Math.tanh(y * this.gain * d) / d
        if (this.exc[v] > 1e-6) {
          z += (this.rnd() * 2 - 1) * this.exc[v]
          this.exc[v] *= excDecay
        }
        buf[wi] = z === z ? z : 0
        this.wi[v] = wi + 1 >= len ? 0 : wi + 1
        mix += y
      }

      const g = (mix / Math.sqrt(n)) * this.out
      const q = g > 1.5 ? 1.5 : g < -1.5 ? -1.5 : g
      out[s] = q === q ? q : 0
      const av = q < 0 ? -q : q
      if (av > peak) peak = av
    }

    this.frames += out.length
    if (this.frames >= sampleRate / 30) {
      this.port.postMessage({ type: 'peak', peak })
      this.frames = 0
      peak = 0
    }
    this.peak = peak
    return true
  }
}

registerProcessor('larsen-loop', LarsenProcessor)
