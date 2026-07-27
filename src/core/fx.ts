/**
 * Effects. Each returns `{ input, output }` plus setters, so you can chain:
 *
 *   const rev = reverb(out, { mix: 0.3 })
 *   const dly = delay(rev.input, { time: '3/16' })
 *   synth = poly(dly.input)
 */

import { audio, noiseBuffer } from './audio'
import { clock } from './clock'

export interface Fx {
  input: GainNode
  /** Wet/dry, 0..1. */
  setMix(v: number): void
  dispose(): void
}

/** Parse "3/16" or "1/8" as seconds at the current tempo, or pass a number. */
export function musicalTime(t: number | string): number {
  if (typeof t === 'number') return t
  const [n, d] = t.split('/').map(Number)
  if (!n || !d) return 0.25
  return (n / d) * clock.secondsPerBeat * 4 // relative to a whole note
}

export function delay(
  dest: AudioNode,
  { time = '3/16' as number | string, feedback = 0.35, mix = 0.25, damp = 3500 } = {},
): Fx & { setTime(t: number | string): void; setFeedback(v: number): void } {
  const { ctx } = audio()
  const input = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const dl = ctx.createDelay(4)
  const fb = ctx.createGain()
  const lp = ctx.createBiquadFilter()

  lp.type = 'lowpass'
  lp.frequency.value = damp
  dl.delayTime.value = musicalTime(time)
  fb.gain.value = Math.min(0.95, feedback)
  wet.gain.value = mix
  dry.gain.value = 1 - mix

  input.connect(dry).connect(dest)
  input.connect(dl)
  dl.connect(lp).connect(fb).connect(dl)
  dl.connect(wet).connect(dest)

  return {
    input,
    setMix(v) {
      wet.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
      dry.gain.setTargetAtTime(1 - v, ctx.currentTime, 0.02)
    },
    setTime(t) {
      dl.delayTime.setTargetAtTime(musicalTime(t), ctx.currentTime, 0.05)
    },
    setFeedback(v) {
      fb.gain.setTargetAtTime(Math.min(0.95, v), ctx.currentTime, 0.02)
    },
    dispose() {
      ;[input, dry, wet, dl, fb, lp].forEach((n) => n.disconnect())
    },
  }
}

/** Convolution reverb with a procedurally generated impulse — no asset to load. */
export function reverb(
  dest: AudioNode,
  { seconds = 2.4, decay = 2.5, mix = 0.3, predelay = 0.01 } = {},
): Fx {
  const { ctx } = audio()
  const input = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const pre = ctx.createDelay(1)
  const conv = ctx.createConvolver()

  conv.buffer = impulseResponse(seconds, decay)
  pre.delayTime.value = predelay
  wet.gain.value = mix
  dry.gain.value = 1 - mix

  input.connect(dry).connect(dest)
  input.connect(pre).connect(conv).connect(wet).connect(dest)

  return {
    input,
    setMix(v) {
      wet.gain.setTargetAtTime(v, ctx.currentTime, 0.05)
      dry.gain.setTargetAtTime(1 - v, ctx.currentTime, 0.05)
    },
    dispose() {
      ;[input, dry, wet, pre, conv].forEach((n) => n.disconnect())
    },
  }
}

function impulseResponse(seconds: number, decay: number): AudioBuffer {
  const { ctx } = audio()
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  const noise = noiseBuffer(Math.max(2, seconds)).getChannelData(0)

  let energy = 0
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    const offset = ch * 977 // decorrelate the channels
    for (let i = 0; i < len; i++) {
      const v = noise[(i + offset) % noise.length] * Math.pow(1 - i / len, decay)
      d[i] = v
      energy += v * v
    }
  }

  // Normalise to unit energy. Without this, a convolver's gain scales with the
  // length of the impulse — a 3s reverb at mix 0.4 arrives ~40x hotter than a
  // 0.5s one, and every sketch downstream ends up fighting the limiter.
  const norm = energy > 0 ? 1 / Math.sqrt(energy / 2) : 1
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] *= norm
  }

  return buf
}

/** Soft saturation. amount 0 = clean, 1 = quite dirty. */
export function drive(dest: AudioNode, { amount = 0.4, mix = 1 } = {}): Fx & { setAmount(v: number): void } {
  const { ctx } = audio()
  const input = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const shaper = ctx.createWaveShaper()
  const post = ctx.createBiquadFilter()

  post.type = 'lowpass'
  post.frequency.value = 12000
  shaper.oversample = '4x'
  shaper.curve = driveCurve(amount)
  wet.gain.value = mix
  dry.gain.value = 1 - mix

  input.connect(dry).connect(dest)
  input.connect(shaper).connect(post).connect(wet).connect(dest)

  return {
    input,
    setAmount(v) {
      shaper.curve = driveCurve(v)
    },
    setMix(v) {
      wet.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
      dry.gain.setTargetAtTime(1 - v, ctx.currentTime, 0.02)
    },
    dispose() {
      ;[input, dry, wet, shaper, post].forEach((n) => n.disconnect())
    },
  }
}

function driveCurve(amount: number) {
  const n = 2048
  const curve = new Float32Array(n)
  const k = Math.max(0.001, amount) * 100
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

/** Stereo widener via a Haas delay on one side. Cheap and effective. */
export function widen(dest: AudioNode, { ms = 12 } = {}): Fx {
  const { ctx } = audio()
  const input = ctx.createGain()
  const merger = ctx.createChannelMerger(2)
  const dl = ctx.createDelay(0.1)
  dl.delayTime.value = ms / 1000

  input.connect(merger, 0, 0)
  input.connect(dl).connect(merger, 0, 1)
  merger.connect(dest)

  return {
    input,
    setMix() {
      /* fixed */
    },
    dispose() {
      ;[input, merger, dl].forEach((n) => n.disconnect())
    },
  }
}
