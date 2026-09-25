/**
 * Finite-amplitude propagation down a bore, in real time.
 *
 * A compression is hotter than a rarefaction, so it travels faster, so the
 * crest of a wave overtakes the trough ahead of it and the waveform shears as
 * it goes. The lossless simple-wave solution is implicit —
 *
 *     y(t) = x(t − D + S·y(t))
 *
 * — a delay line whose read position depends on the value being read. Solved
 * per sample by fixed-point iteration, warm-started from the previous sample,
 * which is where the temporal coherence of audio pays for itself: two or three
 * passes are enough except right at the shock.
 *
 * `S` is the shift in samples per unit amplitude and carries everything:
 * distance, amplitude and frequency all enter only through
 * σ = 2π·S·A·f/fs, which is the dimensionless distance the closed forms use.
 *
 * Plain JS, audio thread, no imports.
 */

const MAXBUF = 8192

class ShearProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 110, minValue: 20, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      /**
       * How far down the bore, as samples of time-shift per unit amplitude.
       * This is the *physical* knob: the dimensionless distance that the
       * closed forms use follows from it as σ = 2π·S·A·f/fs, so a louder note
       * and a higher note both steepen more for the same bore. That is the
       * musical claim and it is not a setting.
       */
      { name: 'shear', defaultValue: 90, minValue: 0, maxValue: 600, automationRate: 'k-rate' },
      /** 0 = lip buzz through a bore, 1 = a bare sine, for reading the physics off. */
      { name: 'tone', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      /** How much the bore rings. */
      { name: 'bore', defaultValue: 0.86, minValue: 0, maxValue: 0.97, automationRate: 'k-rate' },
      /** 1 bypasses the nonlinearity — the control, and the whole comparison. */
      { name: 'linear', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.phase = 0
    this.buf = new Float32Array(MAXBUF)
    this.w = 0
    this.last = 0
    // bore: a waveguide, driven rather than self-oscillating
    this.bore = new Float32Array(MAXBUF)
    this.bw = 0
    this.blp = 0
    // bell: radiation is a high-pass, which is why a bell projects the brass
    this.hp = 0
    this.hpPrev = 0
    /** Worst number of iterations used in the last block — a live shock meter. */
    this.worst = 0
    this.frames = 0
    this.peak = 0
  }

  read(pos) {
    // linear interpolation on the ring buffer
    let p = pos
    while (p < 0) p += MAXBUF
    while (p >= MAXBUF) p -= MAXBUF
    const i = p | 0
    const fr = p - i
    const a = this.buf[i]
    const b = this.buf[i + 1 >= MAXBUF ? 0 : i + 1]
    return a + (b - a) * fr
  }

  process(_inputs, outputs, params) {
    const out = outputs[0][0]
    if (!out) return true
    const f = params.freq[0]
    const level = params.level[0]
    const shear = params.shear[0]
    const tone = params.tone[0] > 0.5
    const boreGain = params.bore[0]
    const linear = params.linear[0] > 0.5

    const period = Math.max(4, sampleRate / f)
    const amp = Math.max(1e-4, level)
    const S = linear ? 0 : shear
    // The read head must never run past the write head. The largest shift is
    // S times the largest sample, so leave room for a full-scale one.
    const D = Math.min(MAXBUF - 8, Math.max(period, S) + 8)
    const bd = Math.max(2, Math.min(MAXBUF - 4, Math.round(period)))
    const inc = (2 * Math.PI * f) / sampleRate

    let worst = 0
    let peak = 0
    let srcPeak = 0
    for (let i = 0; i < out.length; i++) {
      this.phase += inc
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI

      let src
      if (tone) {
        src = amp * Math.sin(this.phase)
      } else {
        // A lip buzz: a sine that closes. At soft dynamics a real lip is nearly
        // sinusoidal in the mouthpiece and only pulses when driven hard, which
        // is what the one-sided clip does. It is a stand-in for a valve, not a
        // model of one — the physics under test is downstream of it.
        const s = Math.sin(this.phase)
        const open = Math.max(0, s + 1 - 2 * level)
        // A comb with feedback g rings at about 1/(1−g), which at 0.97 is 33x
        // and clipped the master at 2.317. Scale the drive by (1−g) so the
        // bore's ring is a timbre and not a level.
        const drive = amp * (open * 2 - 0.45) * ((1 - boreGain) / 0.14)
        // bore: a waveguide, driven at the mouthpiece
        const ret = this.bore[this.bw]
        this.blp = this.blp * 0.55 + ret * 0.45
        const into = drive + this.blp * boreGain
        this.bore[this.bw] = into
        this.bw = this.bw + 1 >= bd ? 0 : this.bw + 1
        src = into * 0.5
      }

      const asrc = src < 0 ? -src : src
      if (asrc > srcPeak) srcPeak = asrc
      this.buf[this.w] = src
      this.w = this.w + 1 >= MAXBUF ? 0 : this.w + 1

      let y
      if (S === 0) {
        y = this.read(this.w - 1 - D)
      } else {
        // Warm-started fixed point. The iteration contracts by |S·x′|, which is
        // σ for a unit sine — so it converges fast everywhere except at the
        // shock, where the physics is singular too.
        y = this.last
        let it = 0
        for (; it < 12; it++) {
          const next = this.read(this.w - 1 - D + S * y)
          const d = next - y
          y = next
          if (d < 1e-6 && d > -1e-6) break
        }
        if (it > worst) worst = it
      }
      this.last = y

      // the bell: radiation rises with frequency, which is why brass carries
      const dc = y - this.hpPrev + 0.995 * this.hp
      this.hpPrev = y
      this.hp = dc
      const v = dc * 0.9
      out[i] = v
      const av = v < 0 ? -v : v
      if (av > peak) peak = av
    }

    this.worst = worst
    this.peak = peak
    this.frames += out.length
    if (this.frames >= sampleRate / 20) {
      this.frames = 0
      // σ is measured, not assumed: the amplitude that goes into it is the
      // peak actually presented to the line.
      this.port.postMessage({ worst, peak, sigma: (2 * Math.PI * S * srcPeak) / period, srcPeak })
    }
    return true
  }
}

registerProcessor('shear-line', ShearProcessor)
