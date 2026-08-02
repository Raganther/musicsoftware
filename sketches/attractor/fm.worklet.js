/**
 * Two FM operators that modulate each other — a coupled nonlinear oscillator.
 *
 *   y1 = sin(2πp1 + a·y2)
 *   y2 = sin(2πp2 + b·y1)
 *
 * Each output feeds the other's phase *within the same sample*, so this is a
 * genuine feedback system and not something native nodes can express: a
 * DelayNode in a cycle is clamped to one 128-sample render quantum, which is
 * already longer than the whole loop here.
 *
 * As the coupling rises the system runs the classic route to chaos: a pure
 * tone gains sidebands, period-doubles, and finally breaks into broadband
 * noise. The interesting music is on the edge, which is why coupling is the
 * timbre knob rather than a safety setting.
 *
 * Stability is structural, not lucky: sin() is bounded whatever its argument,
 * so y1 and y2 can never exceed ±1 however hard the loop is driven, and the
 * tanh on the sum bounds the output below 1 by construction. Chaotic, but it
 * cannot blow up.
 *
 * Plain JS, audio thread. The one allocation is a scope buffer copy posted
 * roughly six times a second for the phase-portrait plot.
 */

const TAU = Math.PI * 2

class AttractorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 110, minValue: 20, maxValue: 4000, automationRate: 'a-rate' },
      { name: 'ratio', defaultValue: 1.5, minValue: 0.25, maxValue: 8, automationRate: 'k-rate' },
      { name: 'couple', defaultValue: 0.6, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'asym', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'blend', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.p1 = 0
    this.p2 = 0
    this.y1 = 0
    this.y2 = 0
    // DC blocker: asymmetric folding of the coupled pair drifts off centre.
    this.hx = 0
    this.hy = 0
    // Phase-portrait tap: interleaved (y1, y2) pairs, decimated.
    this.scope = new Float32Array(1024)
    this.si = 0
    this.decim = 0
  }

  process(_inputs, outputs, params) {
    const out = outputs[0][0]
    if (!out) return true

    const fArr = params.frequency
    const fConst = fArr.length === 1
    const ratio = params.ratio[0]
    const couple = params.couple[0]
    const asym = params.asym[0]
    const blend = params.blend[0]

    // Asymmetric coupling is what stops the pair collapsing into a single
    // symmetric mode — it's the difference between a Lissajous figure and a
    // genuinely strange attractor.
    const a = couple * (1 + asym * 0.8)
    const b = couple * (1 - asym * 0.8)

    for (let i = 0; i < out.length; i++) {
      const f = fConst ? fArr[0] : fArr[i]

      this.p1 += f / sampleRate
      if (this.p1 >= 1) this.p1 -= 1
      this.p2 += (f * ratio) / sampleRate
      if (this.p2 >= 1) this.p2 -= 1

      // Both operators read the PREVIOUS sample of the other. Reading the
      // in-progress value instead makes the recursion order-dependent and the
      // left/right asymmetry stops meaning anything.
      const n1 = Math.sin(TAU * this.p1 + a * this.y2)
      const n2 = Math.sin(TAU * this.p2 + b * this.y1)
      this.y1 = n1
      this.y2 = n2

      const s = Math.tanh((n1 * (1 - blend) + n2 * blend) * 1.4)

      const hp = s - this.hx + 0.995 * this.hy
      this.hx = s
      this.hy = hp
      out[i] = hp * 1.2

      if ((this.decim++ & 15) === 0) {
        this.scope[this.si++] = n1
        this.scope[this.si++] = n2
        if (this.si >= this.scope.length) {
          this.port.postMessage(this.scope.slice())
          this.si = 0
        }
      }
    }
    return true
  }
}

registerProcessor('attractor-fm', AttractorProcessor)
