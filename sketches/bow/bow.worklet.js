/**
 * A bowed string as a digital waveguide.
 *
 * Two delay lines meet at the bow: one runs to the bridge, one to the nut. Each
 * carries a velocity wave. At the bridge the wave reflects inverted and lossy
 * (that loss is the only thing radiating sound); at the nut it reflects
 * inverted and rigid. The bow sits at the junction and is a friction
 * characteristic — the whole instrument is that one nonlinearity in a loop.
 *
 * Splitting the delay is what makes bow position mean anything: beta is the
 * bridge-side fraction of the string, so bowing near the bridge makes one delay
 * line very short and the periodic disturbance it injects very fast.
 *
 * The friction table is Smith's: the fraction of the relative velocity that
 * gets reflected falls off sharply once the bow-string velocity difference is
 * large enough to break the stick. Bow force controls how wide that sticking
 * region is, which is exactly why there is a minimum force below which the
 * string never sticks for long enough to build Helmholtz motion.
 *
 * Plain JS, audio thread. No allocation and no logging inside process().
 */

class BowedStringProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    /** Longest string, ~40 Hz round trip. */
    this.cap = Math.ceil(sampleRate / 40) + 8
    this.bridgeBuf = new Float32Array(this.cap)
    this.nutBuf = new Float32Array(this.cap)
    this.bw = 0
    this.nw = 0

    this.total = 300 // total round-trip delay, samples
    this.target = 300
    this.beta = 0.12
    this.bridgeLen = 36
    this.nutLen = 264

    this.force = 0.12
    this.speed = 0.32
    this.bright = 0.5
    this.bodyMix = 0.45
    this.vib = 0.12
    this.bowing = 0 // smoothed 0..1
    this.bowTarget = 0
    this.jitter = 0

    this.lp = 0 // bridge reflection filter state
    this.dcx = 0
    this.dcy = 0
    this.body1 = 0
    this.body2 = 0
    this.phase = 0

    // periodicity estimate, reported for the drawing
    this.hist = new Float32Array(2048)
    this.hp = 0
    this.reg = 0
    this.peak = 0
    this.frames = 0

    this.port.onmessage = (e) => this.handle(e.data)
    this.relen()
  }

  handle(m) {
    if (m.freq !== undefined) this.target = Math.max(16, Math.min(this.cap - 4, sampleRate / m.freq))
    if (m.beta !== undefined) this.beta = Math.max(0.02, Math.min(0.45, m.beta))
    if (m.force !== undefined) this.force = m.force
    if (m.speed !== undefined) this.speed = m.speed
    if (m.bright !== undefined) this.bright = m.bright
    if (m.body !== undefined) this.bodyMix = m.body
    if (m.vibrato !== undefined) this.vib = m.vibrato
    if (m.jitter !== undefined) this.jitter = m.jitter
    if (m.bow !== undefined) this.bowTarget = m.bow ? 1 : 0
    if (m.type === 'panic') {
      this.bridgeBuf.fill(0)
      this.nutBuf.fill(0)
      this.bowTarget = 0
      this.bowing = 0
    }
    this.relen()
  }

  relen() {
    // Half the round trip each way; beta splits it between bridge and nut side.
    const half = this.total * 0.5
    this.bridgeLen = Math.max(2, Math.round(half * this.beta * 2))
    this.nutLen = Math.max(2, Math.round(half * 2 - this.bridgeLen))
  }

  read(buf, w, d) {
    let i = w - d
    while (i < 0) i += this.cap
    return buf[i]
  }

  /**
   * Smith's bow table. `force` widens the sticking region: with a large force
   * the bow holds the string over a wider range of relative velocity, so the
   * release is late. Below a minimum the string slips continuously and never
   * builds a Helmholtz corner.
   */
  friction(dv) {
    // slope falls as force rises — a stiffer grip
    const slope = 3.0 + 8.0 / (0.02 + this.force * 4)
    const x = Math.abs(dv * slope)
    let out = Math.pow(x + 0.75, -4)
    if (out > 1) out = 1
    return out
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true

    const aLp = 0.25 + this.bright * 0.7
    let peak = this.peak

    for (let i = 0; i < out.length; i++) {
      if (this.total !== this.target) {
        this.total += (this.target - this.total) * 0.002
        if (Math.abs(this.total - this.target) < 0.5) this.total = this.target
        this.relen()
      }
      this.bowing += (this.bowTarget - this.bowing) * (this.bowTarget > this.bowing ? 0.0012 : 0.0008)

      // vibrato moves the bow's velocity a little, not the pitch — a bow's
      // pressure and speed are never actually steady
      this.phase += 5.2 / sampleRate
      if (this.phase > 1) this.phase -= 1
      const wobble = 1 + this.vib * 0.12 * Math.sin(this.phase * Math.PI * 2) + this.jitter

      // waves arriving at the bow from each side
      const fromBridge = this.read(this.bridgeBuf, this.bw, this.bridgeLen)
      const fromNut = this.read(this.nutBuf, this.nw, this.nutLen)

      // bridge reflects inverted through a one-pole loss; nut is rigid
      this.lp += (fromBridge - this.lp) * aLp
      const bridgeRefl = -0.995 * this.lp
      const nutRefl = -fromNut

      const stringVel = bridgeRefl + nutRefl
      const bowVel = this.speed * 0.35 * this.bowing * wobble
      const dv = bowVel - stringVel
      const added = dv * this.friction(dv)

      this.bridgeBuf[this.bw] = nutRefl + added
      this.nutBuf[this.nw] = bridgeRefl + added
      this.bw = this.bw + 1 >= this.cap ? 0 : this.bw + 1
      this.nw = this.nw + 1 >= this.cap ? 0 : this.nw + 1

      // what the bridge radiates
      let s = bridgeRefl
      const d = s - this.dcx + 0.999 * this.dcy
      this.dcx = s
      this.dcy = d
      s = d

      // a cheap body: two resonances, mixed in
      this.body1 += (s - this.body1) * 0.22
      this.body2 += (this.body1 - this.body2) * 0.06
      s = s * (1 - this.bodyMix * 0.5) + (this.body1 - this.body2) * this.bodyMix * 2.2

      s = Math.tanh(s * 1.4) * 1.6
      out[i] = s

      const a = s < 0 ? -s : s
      if (a > peak) peak = a
      this.hist[this.hp] = s
      this.hp = this.hp + 1 >= this.hist.length ? 0 : this.hp + 1
    }

    this.frames += out.length
    if (this.frames >= sampleRate / 25) {
      this.reg = this.periodicity()
      this.port.postMessage({ peak, reg: this.reg })
      this.frames = 0
      peak = 0
    }
    this.peak = peak
    return true
  }

  /**
   * How periodic the output is at the string's own period — the fraction of
   * the signal that repeats exactly one round trip later. Clean Helmholtz
   * motion approaches 1; surface sound and crushed tone do not.
   */
  periodicity() {
    const lag = Math.round(this.total)
    const n = this.hist.length
    if (lag < 8 || lag > n / 2) return 0
    let num = 0
    let d1 = 0
    let d2 = 0
    for (let i = 0; i < n - lag; i++) {
      const a = this.hist[(this.hp + i) % n]
      const b = this.hist[(this.hp + i + lag) % n]
      num += a * b
      d1 += a * a
      d2 += b * b
    }
    const den = Math.sqrt(d1 * d2)
    return den > 1e-9 ? Math.max(0, num / den) : 0
  }
}

registerProcessor('bowed-string', BowedStringProcessor)
