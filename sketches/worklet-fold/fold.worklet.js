/**
 * A phase-distortion + wavefolding oscillator, written sample by sample.
 *
 * This file is deliberately plain JavaScript, not TypeScript: it is loaded as
 * a URL by `audioWorklet.addModule()`, which needs a real file the browser can
 * fetch in both dev and build. Worklet scope has no DOM and no imports.
 *
 * Runs on the audio thread — no allocation, no logging in `process`.
 */

class FoldProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 110, minValue: 20, maxValue: 8000, automationRate: 'a-rate' },
      { name: 'fold', defaultValue: 1.5, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'skew', defaultValue: 0.5, minValue: 0.02, maxValue: 0.98, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.phase = 0
    // One-pole DC blocker — folding is not symmetric and the offset builds up.
    this.lastIn = 0
    this.lastOut = 0
  }

  process(_inputs, outputs, params) {
    const out = outputs[0]
    if (!out || !out.length) return true

    const ch0 = out[0]
    const freqArr = params.frequency
    const freqIsConst = freqArr.length === 1
    const fold = params.fold[0]
    const skew = params.skew[0]
    const gain = params.gain[0]

    for (let i = 0; i < ch0.length; i++) {
      const freq = freqIsConst ? freqArr[0] : freqArr[i]

      this.phase += freq / sampleRate
      if (this.phase >= 1) this.phase -= 1

      // Phase distortion: bend the ramp so the first half of the cycle runs
      // faster or slower. At skew 0.5 this is an ordinary sine.
      const p =
        this.phase < skew
          ? (this.phase / skew) * 0.5
          : 0.5 + ((this.phase - skew) / (1 - skew)) * 0.5

      // Wavefold: pushing a sine through another sine reflects the peaks back
      // on themselves, adding harmonics that track the fundamental.
      let s = Math.sin(2 * Math.PI * p)
      s = Math.sin(s * fold * Math.PI * 0.5)

      // DC blocker
      const filtered = s - this.lastIn + 0.995 * this.lastOut
      this.lastIn = s
      this.lastOut = filtered

      ch0[i] = filtered * gain
    }

    for (let c = 1; c < out.length; c++) out[c].set(ch0)
    return true
  }
}

registerProcessor('fold-osc', FoldProcessor)
