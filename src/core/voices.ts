/**
 * Ready-made sound sources, so a new sketch makes noise in a couple of lines.
 *
 * These are intentionally plain Web Audio graphs — readable, hackable, and
 * cheap to copy into a sketch when you want to mutate one. If you find
 * yourself fighting one of these, copy it into your sketch rather than adding
 * options here.
 */

import { audio, disposeAt, envelope, noiseSource } from './audio'
import { mtof } from './theory'

export type Wave = OscillatorType

// ---------------------------------------------------------------------------
// Polyphonic subtractive synth
// ---------------------------------------------------------------------------

export interface SynthOptions {
  wave: Wave
  /** Second oscillator detune in cents. 0 disables it. */
  detune: number
  cutoff: number
  resonance: number
  /** Filter envelope depth in octaves above cutoff. */
  envAmount: number
  /** Filter topology. Lowpass unless you mean it. */
  filterType: 'lowpass' | 'highpass' | 'bandpass'
  /** Sine sub-oscillator one octave down, 0..1 relative level. */
  sub: number
  /**
   * Stereo spread 0..1. Voices are placed deterministically around the field
   * (golden-angle sequence), so the image is wide but reproducible.
   */
  spread: number
  /** How much velocity scales the filter envelope, 0..1. Soft = darker. */
  velToFilter: number
  /** Cutoff keyboard tracking, 0..1. High notes open the filter. */
  keytrack: number
  attack: number
  decay: number
  sustain: number
  release: number
  gain: number
  /**
   * Hard cap on simultaneous voices; the oldest is stolen past this.
   * Generative sketches will happily stack fifty overlapping notes and then
   * blame the limiter for the mush, so this is a cap, not a suggestion.
   */
  maxVoices: number
}

const DEFAULTS: SynthOptions = {
  wave: 'sawtooth',
  detune: 8,
  cutoff: 1800,
  resonance: 6,
  envAmount: 2,
  filterType: 'lowpass',
  sub: 0,
  spread: 0,
  velToFilter: 0,
  keytrack: 0,
  attack: 0.005,
  decay: 0.18,
  sustain: 0.6,
  release: 0.25,
  /** Approximate peak amplitude of a single voice at full velocity. */
  gain: 0.5,
  maxVoices: 12,
}

interface Voice {
  midi: number
  /** When this voice is fully silent, for lazy pruning. */
  endTime: number
  release: (time: number, fast?: boolean) => void
}

export class PolySynth {
  opts: SynthOptions
  private dest: AudioNode
  private held = new Map<number, Voice>()
  private active: Voice[] = []
  private voiceSerial = 0

  constructor(dest: AudioNode, opts: Partial<SynthOptions> = {}) {
    this.dest = dest
    this.opts = { ...DEFAULTS, ...opts }
  }

  /** Set options after construction. Applies to notes started from now on. */
  set(opts: Partial<SynthOptions>) {
    Object.assign(this.opts, opts)
  }

  private build(midi: number, time: number, velocity: number): Voice {
    const { ctx } = audio()
    const o = this.opts
    const freq = mtof(midi)

    const amp = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = o.filterType
    filter.Q.value = o.resonance

    // Keytracking opens the filter as pitch rises; velocity scales the
    // envelope so soft notes are darker, not just quieter.
    const baseCutoff = Math.min(
      18000,
      Math.max(40, o.cutoff * Math.pow(freq / 261.63, o.keytrack)),
    )
    const envDepth = o.envAmount * (1 - o.velToFilter * (1 - velocity))
    const peakCutoff = Math.min(ctx.sampleRate / 2 - 1000, baseCutoff * Math.pow(2, envDepth))
    filter.frequency.cancelScheduledValues(time)
    filter.frequency.setValueAtTime(baseCutoff, time)
    filter.frequency.linearRampToValueAtTime(peakCutoff, time + o.attack)
    filter.frequency.exponentialRampToValueAtTime(
      baseCutoff,
      time + o.attack + o.decay + 0.001,
    )

    const oscCount = o.detune > 0 ? 2 : 1

    // Two things otherwise make `gain` a lie about how loud a voice is:
    // stacked oscillators sum, and a resonant filter has a large peak (Q=6 is
    // ~+16dB at cutoff). Normalise both so `gain` really is roughly the peak
    // amplitude of one voice, and changing resonance doesn't change loudness.
    const oscMix = ctx.createGain()
    oscMix.gain.value = 1 / (oscCount + o.sub)
    // Resonance compensation is for filters whose peak grows with Q — a
    // biquad bandpass peaks at unity regardless, so compensating it just
    // makes the mode mysteriously quiet.
    const qComp = o.filterType === 'bandpass' ? 1 : 1 / Math.sqrt(Math.max(1, o.resonance))

    const peak = o.gain * velocity * qComp
    amp.gain.cancelScheduledValues(time)
    amp.gain.setValueAtTime(0, time)
    amp.gain.linearRampToValueAtTime(peak, time + o.attack)
    amp.gain.linearRampToValueAtTime(peak * o.sustain, time + o.attack + o.decay)

    const oscs: OscillatorNode[] = []
    for (let i = 0; i < oscCount; i++) {
      const osc = ctx.createOscillator()
      osc.type = o.wave
      osc.frequency.value = freq
      osc.detune.value = i === 0 ? -o.detune : o.detune
      osc.connect(oscMix)
      osc.start(time)
      oscs.push(osc)
    }

    const extras: AudioNode[] = [oscMix, filter, amp]

    if (o.sub > 0) {
      const sub = ctx.createOscillator()
      sub.type = 'sine'
      sub.frequency.value = freq / 2
      const subGain = ctx.createGain()
      subGain.gain.value = o.sub
      sub.connect(subGain).connect(oscMix)
      extras.push(subGain)
      sub.start(time)
      oscs.push(sub)
    }

    oscMix.connect(filter)
    filter.connect(amp)

    if (o.spread > 0) {
      // Golden-angle walk around the stereo field: wide, even, and — unlike
      // Math.random — the same every run.
      const pan = ctx.createStereoPanner()
      pan.pan.value = Math.sin(this.voiceSerial++ * 2.399963) * o.spread
      amp.connect(pan).connect(this.dest)
      extras.push(pan)
    } else {
      amp.connect(this.dest)
    }

    const voice: Voice = {
      midi,
      endTime: Infinity,
      release: (t: number, fast = false) => {
        // Never release before the note starts. Sequenced notes are scheduled
        // ahead of time, so a steal can arrive while this voice is still in
        // the future.
        const at = Math.max(t, time)
        const end = at + (fast ? 0.015 : this.opts.release)
        // Only ever bring the ending forward, so a duplicate noteOff or a
        // steal after the natural release can't restart the envelope.
        if (end >= voice.endTime) return

        // cancelScheduledValues() would discard the pending setValueAtTime(0)
        // and leave the param at its *default* of 1 — a full-amplitude click,
        // regardless of velocity. cancelAndHold keeps the curve's value.
        if (typeof amp.gain.cancelAndHoldAtTime === 'function') {
          amp.gain.cancelAndHoldAtTime(at)
        } else {
          amp.gain.cancelScheduledValues(at)
          amp.gain.setValueAtTime(at <= time ? 0 : Math.max(1e-4, amp.gain.value), at)
        }
        amp.gain.linearRampToValueAtTime(0, end)

        oscs.forEach((osc, i) => disposeAt(osc, end + 0.02, i === 0 ? extras : undefined))
        voice.endTime = end + 0.02
      },
    }
    return voice
  }

  /** Register a new voice, stealing the oldest if we're at the cap. */
  private track(voice: Voice) {
    const { ctx } = audio()
    const now = ctx.currentTime
    this.active = this.active.filter((v) => v.endTime > now)
    while (this.active.length >= this.opts.maxVoices) {
      this.active.shift()?.release(now, true)
    }
    this.active.push(voice)
  }

  /** Fire and forget: a note of fixed length. This is what sequencers want. */
  note(midi: number, time?: number, duration = 0.2, velocity = 1) {
    const { ctx } = audio()
    const t = time ?? ctx.currentTime
    const v = this.build(midi, t, velocity)
    this.track(v)
    v.release(t + duration)
  }

  /** Held note, for keyboards and MIDI input. */
  noteOn(midi: number, velocity = 1, time?: number) {
    const { ctx } = audio()
    const t = time ?? ctx.currentTime
    this.held.get(midi)?.release(t)
    const v = this.build(midi, t, velocity)
    this.track(v)
    this.held.set(midi, v)
  }

  noteOff(midi: number, time?: number) {
    const { ctx } = audio()
    const v = this.held.get(midi)
    if (!v) return
    this.held.delete(midi)
    v.release(time ?? ctx.currentTime)
  }

  allNotesOff() {
    const { ctx } = audio()
    for (const [midi] of this.held) this.noteOff(midi, ctx.currentTime)
  }
}

export const poly = (dest: AudioNode, opts?: Partial<SynthOptions>) => new PolySynth(dest, opts)

// ---------------------------------------------------------------------------
// Drums — synthesised, no samples to load
// ---------------------------------------------------------------------------

export interface DrumKit {
  kick(time?: number, vel?: number): void
  snare(time?: number, vel?: number): void
  hat(time?: number, vel?: number, open?: boolean): void
  clap(time?: number, vel?: number): void
  tom(time?: number, vel?: number, pitch?: number): void
  rim(time?: number, vel?: number): void
}

export function drums(dest: AudioNode): DrumKit {
  const at = (t?: number) => t ?? audio().ctx.currentTime

  return {
    kick(time, vel = 1) {
      const { ctx } = audio()
      const t = at(time)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.setValueAtTime(150, t)
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.09)
      envelope(gain.gain, t, { peak: 0.9 * vel, attack: 0.001, decay: 0.35 })
      osc.connect(gain).connect(dest)
      osc.start(t)
      disposeAt(osc, t + 0.4, [gain])
    },

    snare(time, vel = 1) {
      const { ctx } = audio()
      const t = at(time)

      const noise = noiseSource()
      const nf = ctx.createBiquadFilter()
      nf.type = 'highpass'
      nf.frequency.value = 1400
      const ng = ctx.createGain()
      envelope(ng.gain, t, { peak: 0.5 * vel, attack: 0.001, decay: 0.14 })
      noise.connect(nf).connect(ng).connect(dest)
      noise.start(t)
      disposeAt(noise, t + 0.2, [nf, ng])

      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(210, t)
      osc.frequency.exponentialRampToValueAtTime(150, t + 0.08)
      const og = ctx.createGain()
      envelope(og.gain, t, { peak: 0.35 * vel, attack: 0.001, decay: 0.09 })
      osc.connect(og).connect(dest)
      osc.start(t)
      disposeAt(osc, t + 0.15, [og])
    },

    hat(time, vel = 1, open = false) {
      const { ctx } = audio()
      const t = at(time)
      const noise = noiseSource()
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 7000
      const gain = ctx.createGain()
      const decay = open ? 0.28 : 0.045
      envelope(gain.gain, t, { peak: 0.28 * vel, attack: 0.001, decay })
      noise.connect(hp).connect(gain).connect(dest)
      noise.start(t)
      disposeAt(noise, t + decay + 0.1, [hp, gain])
    },

    clap(time, vel = 1) {
      const { ctx } = audio()
      const t = at(time)
      // Three quick bursts then a tail — the classic 909 trick.
      for (const [i, offset] of [0, 0.009, 0.018, 0.028].entries()) {
        const noise = noiseSource()
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 1100
        bp.Q.value = 1.2
        const g = ctx.createGain()
        const decay = i === 3 ? 0.16 : 0.012
        envelope(g.gain, t + offset, { peak: 0.4 * vel, attack: 0.001, decay })
        noise.connect(bp).connect(g).connect(dest)
        noise.start(t + offset)
        disposeAt(noise, t + offset + decay + 0.05, [bp, g])
      }
    },

    tom(time, vel = 1, pitch = 180) {
      const { ctx } = audio()
      const t = at(time)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const g = ctx.createGain()
      osc.frequency.setValueAtTime(pitch, t)
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, t + 0.18)
      envelope(g.gain, t, { peak: 0.55 * vel, attack: 0.002, decay: 0.25 })
      osc.connect(g).connect(dest)
      osc.start(t)
      disposeAt(osc, t + 0.35, [g])
    },

    rim(time, vel = 1) {
      const { ctx } = audio()
      const t = at(time)
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = 1700
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1700
      bp.Q.value = 8
      const g = ctx.createGain()
      envelope(g.gain, t, { peak: 0.3 * vel, attack: 0.0005, decay: 0.035 })
      osc.connect(bp).connect(g).connect(dest)
      osc.start(t)
      disposeAt(osc, t + 0.1, [bp, g])
    },
  }
}

// ---------------------------------------------------------------------------
// One-shot helpers
// ---------------------------------------------------------------------------

/** A single plucked tone. Good for quick "does my sequencer tick?" checks. */
export function blip(dest: AudioNode, midi: number, time?: number, dur = 0.12, wave: Wave = 'triangle') {
  const { ctx } = audio()
  const t = time ?? ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = wave
  osc.frequency.value = mtof(midi)
  envelope(g.gain, t, { peak: 0.3, attack: 0.004, decay: dur })
  osc.connect(g).connect(dest)
  osc.start(t)
  disposeAt(osc, t + dur + 0.1, [g])
}
