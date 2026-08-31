/**
 * Pitch with mass, moving in a landscape of wells.
 *
 * A keyboard normally *assigns* a pitch: you press a key and the pitch is that
 * key's. Here a key is only an aim. Pitch is a particle with position x (in
 * semitones above the root) and velocity, and the key applies a spring force
 * toward its note while you hold it. Let go and the only forces left are
 * damping and the landscape:
 *
 *     U(x) = A·(1 − cos(2πx/s))
 *     F    = −dU/dx = −A·(2π/s)·sin(2πx/s)
 *
 * — a row of wells s semitones apart. The instrument's actual pitches are the
 * minima of that landscape, and they have nothing to do with where the keys
 * are. At s = 1 the two agree and it behaves like a normal instrument. At
 * s = 2.4 the keyboard is still chromatic and the instrument is 5-EDO, so
 * pressing a key aims at a pitch the instrument does not have and you land on
 * whichever well caught you.
 *
 * Three numbers fall out of that and all three are testable from the audio:
 *
 *   the wobble on landing    f = √A / s          Hz
 *   the barrier between wells  ΔU = 2A
 *   so the escape velocity     |v| > 2√A         semitones/second
 *
 * The last one is the interesting one. It says exactly how hard you have to
 * throw the pitch to get it out of the well it is sitting in — and because
 * damping steals energy on the way up, the *measured* threshold must sit above
 * 2√A and converge onto it as damping goes to zero. That is a prediction with a
 * direction, not just a number.
 *
 * Damping is quoted as a ratio ζ against the key spring, because that is the
 * gesture a player feels: ζ < 1 overshoots the note you aimed at, by exactly
 * exp(−πζ/√(1−ζ²)) of the distance. Against the *wells* the same absolute
 * damping is a different ratio, which is why a landing wobbles for much longer
 * than a keypress overshoots.
 *
 * Plain JS, audio thread. No allocation inside process().
 */

const TWO_PI = Math.PI * 2

/** PolyBLEP correction, so a sawtooth swept over three octaves stays clean. */
function blep(t, dt) {
  if (t < dt) {
    const u = t / dt
    return u + u - u * u - 1
  }
  if (t > 1 - dt) {
    const u = (t - 1) / dt
    return u * u + u + u + 1
  }
  return 0
}

class InertiaProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // -- the particle --------------------------------------------------------
    this.x = 0 // semitones above root
    this.v = 0 // semitones per second
    this.target = 0
    this.gate = 0

    // -- the landscape -------------------------------------------------------
    this.A = 36 // well depth, (semitones/s)²
    this.s = 1 // well spacing, semitones
    this.wk = TWO_PI * 2 // key spring, rad/s
    this.zeta = 0.5 // damping, as a ratio against the key spring
    this.lo = -18
    this.hi = 18

    // -- the voice -----------------------------------------------------------
    this.root = 48
    this.gain = 0.3
    this.detune = 6
    this.detuneRatio = Math.pow(2, 6 / 1200)
    this.env = 0
    this.envTarget = 0
    this.ph1 = 0
    this.ph2 = 0
    this.lp = 0
    this.lp2 = 0
    this.bright = 0
    this.holdFor = 0

    this.peak = 0
    this.frames = 0

    this.port.onmessage = (e) => this.handle(e.data)
  }

  handle(m) {
    if (m.A !== undefined) this.A = m.A
    if (m.s !== undefined) this.s = Math.max(0.05, m.s)
    if (m.pull !== undefined) this.wk = TWO_PI * Math.max(0.05, m.pull)
    if (m.zeta !== undefined) this.zeta = m.zeta
    if (m.root !== undefined) this.root = m.root
    if (m.gain !== undefined) this.gain = m.gain
    if (m.detune !== undefined) {
      this.detune = m.detune
      this.detuneRatio = Math.pow(2, m.detune / 1200)
    }
    if (m.range !== undefined) {
      this.lo = -m.range
      this.hi = m.range
    }
    if (m.target !== undefined) this.target = m.target
    if (m.gate !== undefined) {
      this.gate = m.gate
      this.envTarget = m.gate ? 1 : 0
    }
    /**
     * A velocity impulse, in semitones/second. This is the handle the escape
     * experiment needs: it sets the velocity outright rather than asking for
     * it via a force, so the number under test is the number applied.
     */
    if (m.kick !== undefined) this.v = m.kick
    if (m.place !== undefined) {
      this.x = m.place
      this.v = 0
    }
    /**
     * Hold the voice open without gating the key spring.
     *
     * Measuring a release needs the note to still be sounding while it settles,
     * and the obvious way to get that — hold a key — applies the very force
     * whose absence is under test. This separates "make a sound" from "push the
     * pitch", which the instrument does not need but the experiment does.
     */
    if (m.sustain !== undefined) {
      this.envTarget = m.sustain ? 1 : 0
      this.holdFor = 0
    }
    /** A nudge that also opens the envelope, so the sketch can play itself. */
    if (m.nudge !== undefined) {
      this.v += m.nudge
      this.envTarget = 1
      this.holdFor = Math.round(sampleRate * 0.14)
    }
    if (m.type === 'panic') {
      this.x = 0
      this.v = 0
      this.env = 0
      this.envTarget = 0
      this.gate = 0
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const sr = sampleRate
    const dt = 1 / sr

    // One absolute damping coefficient, quoted to the outside world as a ratio
    // against the key spring. The wells see the same c as a much smaller ratio,
    // which is why landings ring and keypresses do not.
    const c = 2 * this.zeta * this.wk
    const ws = TWO_PI / this.s
    const kw = this.A * ws
    const wk2 = this.wk * this.wk
    const aUp = 1 - Math.exp(-1 / (0.004 * sr))
    const aDown = 1 - Math.exp(-1 / (0.32 * sr))

    let peak = this.peak

    for (let n = 0; n < out.length; n++) {
      // -- the particle ------------------------------------------------------
      let a = -c * this.v - kw * Math.sin(ws * this.x)
      if (this.gate) a += wk2 * (this.target - this.x)
      this.v += a * dt
      this.x += this.v * dt
      // The ends of the range are walls, not wraps — a wrap would teleport the
      // pitch and the glide is the whole point.
      if (this.x < this.lo) {
        this.x = this.lo
        this.v = -this.v * 0.35
      } else if (this.x > this.hi) {
        this.x = this.hi
        this.v = -this.v * 0.35
      }

      if (this.holdFor > 0 && --this.holdFor === 0 && !this.gate) this.envTarget = 0

      // -- the voice ---------------------------------------------------------
      const e = this.envTarget - this.env
      this.env += e * (e > 0 ? aUp : aDown)

      const f = 440 * Math.pow(2, (this.root + this.x - 69) / 12)
      const inc = Math.min(0.45, f / sr)
      // Cents, as the label says. `1 + cents*0.01` is percent, which made the
      // default 6-"cent" detune a 101-cent one — the second oscillator was a
      // semitone sharp, and at the top of the range it was a fourth.
      const inc2 = Math.min(0.45, (f * this.detuneRatio) / sr)
      this.ph1 += inc
      if (this.ph1 >= 1) this.ph1 -= 1
      this.ph2 += inc2
      if (this.ph2 >= 1) this.ph2 -= 1
      const saw =
        (2 * this.ph1 - 1 - blep(this.ph1, inc) + (2 * this.ph2 - 1 - blep(this.ph2, inc2))) * 0.5

      // Movement opens the filter. A pitch travelling fast is a gesture in
      // progress, and hearing that is most of what makes the thing playable.
      const speed = this.v < 0 ? -this.v : this.v
      this.bright += (Math.min(1, speed / 14) - this.bright) * 0.0008
      const cut = Math.min(0.46, ((f * (2.2 + this.bright * 9)) / sr) * TWO_PI)
      const g1 = cut > 1 ? 1 : cut
      this.lp += g1 * (saw - this.lp)
      this.lp2 += g1 * (this.lp - this.lp2)

      const y = this.lp2 * this.env * this.gain
      const q = y > 1.6 ? 1.6 : y < -1.6 ? -1.6 : y
      out[n] = q === q ? q : 0
      const av = q < 0 ? -q : q
      if (av > peak) peak = av
    }

    this.frames += out.length
    if (this.frames >= sr / 30) {
      this.port.postMessage({
        peak, x: this.x, v: this.v, env: this.env, bright: this.bright,
      })
      this.frames = 0
      peak = 0
    }
    this.peak = peak
    return true
  }
}

registerProcessor('inertia-pitch', InertiaProcessor)
