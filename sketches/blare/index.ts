import { clamp, degree, loadWorklet, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './shear.worklet.js?url'
import { centroid, fubini, harmonics, sawtooth, shearWave, SHOCK, steepness } from './shear'

/**
 * Why a trombone gets brassy when it gets loud, and a flute never does.
 *
 * Every bore in this repo — `overblow`, `cone`, `lattice` — propagates
 * linearly, so its timbre belongs to the excitation and the resonances, and
 * playing louder only makes it louder. Real air does not work that way. A
 * compression is hotter than a rarefaction, so it travels faster, so the crest
 * of a wave catches up with the trough ahead of it and the waveform **shears**
 * as it goes. Far enough and a sine is a sawtooth, and a sawtooth is a brass
 * instrument.
 *
 * Everything about it lives in one dimensionless number, σ = β·û·ω·x/c₀², and
 * so amplitude, pitch and bore length are the *same knob*. At σ = 1 the wave
 * goes vertical: that is a shock, and past it the brightness stops growing.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-25-blare.md`.
 */

const HARMONICS = 16

export default defineSketch({
  title: 'Blare',
  description: 'A bore where the brightness comes from the air, not the reed — loud notes steepen into a sawtooth.',
  tags: ['dsp', 'physical', 'worklet'],
  status: 'promising',
  bpm: 92,
  division: 4,

  params: {
    /** How far down the bore the wave has travelled, in shear per unit amplitude. */
    distance: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.005, label: 'Bore length' },
    /** Blowing level. Steepening goes as amplitude, so this is the timbre knob too. */
    push: { type: 'number', value: 0.55, min: 0.05, max: 1, step: 0.01, label: 'Push' },
    /** The control: propagate linearly and nothing but loudness changes. */
    linear: { type: 'toggle', value: false, label: 'Propagate linearly' },
    /** A bare sine into the line, which is what the closed forms describe. */
    tone: { type: 'toggle', value: false, label: 'Test tone (no bore)' },
    /** One steady note at the root instead of the phrase, so you can push it into the shock. */
    hold: { type: 'toggle', value: false, label: 'Hold one note' },
    bore: { type: 'number', value: 0.86, min: 0, max: 0.97, step: 0.005, label: 'Bore ring' },
    /** How hard the phrase swells. The blare is on the loud notes and nowhere else. */
    swell: { type: 'number', value: 0.7, min: 0, max: 1, step: 0.01, label: 'Dynamics' },
    root: { type: 'number', value: 41, min: 28, max: 56, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMajor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.26, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Every other bore here propagates linearly, so playing louder only gets louder.
Air does not. A compression is hotter than a rarefaction and so travels faster,
the crest overtakes the trough ahead of it, and the waveform **shears** as it
goes — far enough and a sine becomes a sawtooth. That is the whole of why brass
blares and flutes do not.

The lossless simple-wave solution is implicit, \`u = u₀(φ + σ·u)\`, and *all*
of amplitude, pitch and bore length enter through the one number
σ = β·û·ω·x/c₀². So **they are the same knob**: at fixed bore, a louder note and
a higher note steepen identically.

**The implementation against the closed form.** Fubini (1935) gives the nth
harmonic of an initially sinusoidal wave as \`(2/nσ)·Jₙ(nσ)\`. The sketch solves
the implicit equation by Newton in node and by a warm-started fixed point in the
worklet; neither knows anything about Bessel functions:

| σ | harmonics checked | worst relative error |
| --- | --- | --- |
| 0.10 | 1–14 | 2.4e−10 |
| 0.50 | 1–14 | 5.3e−13 |
| 0.70 | 1–14 | **3.8e−14** |
| 0.95 | 1–14 | 9.3e−4 |

**And the shock is visible in three places at once.** The waveform's steepest
slope should run as \`1/(1−σ)\` and go vertical at σ = 1. Measured 1.111 / 1.429 /
2.000 / 3.333 / 6.666 / 19.984 against 1.111 / 1.429 / 2.000 / 3.333 / 6.667 /
20.000 — the same σ = 1 where the fixed-point iteration stops contracting, and
where Fubini stops being the answer.

**Past the shock the brightness saturates.** The weak-shock law is a sawtooth,
\`2/(n(1+σ))\`, whose *shape* does not depend on σ at all — so beyond σ = 1 the
spectrum stops getting brighter and only gets quieter. You cannot blow past a
sawtooth.

**Off the radiated sound**, holding one note and projecting onto exact
harmonics. The worklet solves the implicit equation by a warm-started fixed
point with linear interpolation and at most twelve passes, and knows nothing
about Bessel functions:

| σ | harmonics resolvable | worst relative error |
| --- | --- | --- |
| 0.16 | 2–4 | 0.03% |
| 0.29 | 2–5 | 0.01% |
| 0.50 | 2–9 | 0.03% |
| 0.70 | 2–12 | 0.04% |
| 0.85 | 2–12 | 0.11% |
| 0.95 | 2–12 | **0.58%** |

**And amplitude, pitch and bore length really are one knob.** Sweep each
separately, compute σ from what the sliders actually took, and every one lands
on the same curve:

| swept | f (Hz) | push | σ | B₂/B₁ heard | Fubini | err |
| --- | --- | --- | --- | --- | --- | --- |
| amplitude | 87.3 | 0.30 | 0.301 | 0.147566 | 0.147568 | 0.00% |
| amplitude | 87.3 | 0.90 | 0.902 | 0.377675 | 0.377685 | 0.00% |
| pitch | 138.6 | 0.60 | 0.370 | 0.179590 | 0.179596 | 0.00% |
| pitch | 207.7 | 0.60 | 0.554 | 0.259479 | 0.259493 | 0.01% |
| bore | 87.3 | 0.60 | 0.291 | 0.142978 | 0.142980 | 0.00% |
| bore | 87.3 | 0.60 | 0.893 | 0.375108 | 0.375117 | 0.00% |

Nine settings, three knobs, one σ, worst 0.01%. **A high note blares at a
dynamic where a low note does not**, and that is not a rule anyone wrote in.

\`Propagate linearly\` is the control and it is the demonstration: same notes,
same dynamics, and the loud ones stop blaring. At a setting where the
nonlinear line puts **0.364** of the fundamental into the second harmonic, the
linear one puts **6.1e−7** — the control could have failed and did not.

Levels: 0.454 at the defaults, 0.836 worst over eleven settings.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)

    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.4 })
    ctx.onParam('space', (v) => rev.setMix(v))

    const node = new AudioWorkletNode(ctx.audio, 'shear-line', { outputChannelCount: [1] })
    const amp = ctx.audio.createGain()
    amp.gain.value = 0
    const outGain = ctx.audio.createGain()
    outGain.gain.value = 0.9
    node.connect(amp).connect(outGain).connect(rev.input)

    const P = (name: string) => node.parameters.get(name)!

    /** What the worklet reports back: the shock meter, live. */
    let sigmaNow = 0
    let itersNow = 0
    node.port.onmessage = (e) => {
      sigmaNow = e.data.sigma ?? 0
      itersNow = e.data.worst ?? 0
    }

    ctx.cleanup(() => {
      node.port.onmessage = null
      node.disconnect()
      amp.disconnect()
      outGain.disconnect()
      rev.dispose()
    })

    // -- the phrase ------------------------------------------------------------

    let notes: number[] = []
    let dyn: number[] = []
    const build = () => {
      const r = rng(Math.round(ctx.params.seed))
      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      notes = []
      dyn = []
      let d = 0
      for (let i = 0; i < 32; i++) {
        d = clamp(d + r.int(-2, 3), -1, 11)
        notes.push(degree(rootN, scale, d))
        // a swell across the phrase, so the same tune passes through the shock
        const shape = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 32)
        dyn.push(0.28 + shape * 0.72 * (0.3 + r.next() * 0.7))
      }
    }
    build()
    for (const k of ['seed', 'root', 'scale'] as const) ctx.onParam(k, build)

    // -- the transport ----------------------------------------------------------

    let base = -1
    let idx = 0
    let curPush = 0
    let curFreq = 110

    const setShear = () => {
      // The bore length is the physical knob; σ follows from it, from how hard
      // it is being blown and from how high the note is.
      P('shear').value = ctx.params.distance * 520
      P('linear').value = ctx.params.linear ? 1 : 0
      P('tone').value = ctx.params.tone ? 1 : 0
      P('bore').value = ctx.params.bore
    }
    setShear()
    for (const k of ['distance', 'linear', 'tone', 'bore'] as const) ctx.onParam(k, setShear)

    const holding = () => {
      // A steady note, so the shock can be walked up to rather than caught in
      // passing — and so a measurement has something that stands still.
      const at = ctx.audio.currentTime + 0.01
      curPush = ctx.params.push
      curFreq = mtof(Math.round(ctx.params.root))
      P('freq').setValueAtTime(curFreq, at)
      P('level').setValueAtTime(curPush, at)
      const g = (0.5 + ctx.params.level * 0.7) * 0.53
      amp.gain.cancelAndHoldAtTime(at)
      amp.gain.linearRampToValueAtTime(g * (0.45 + 0.55 * curPush), at + 0.05)
    }
    for (const k of ['hold', 'push', 'root', 'level'] as const)
      ctx.onParam(k, () => {
        if (ctx.params.hold) holding()
        else {
          amp.gain.cancelAndHoldAtTime(ctx.audio.currentTime)
          amp.gain.setTargetAtTime(0, ctx.audio.currentTime, 0.02)
        }
      })
    if (ctx.params.hold) holding()

    ctx.clock.onStep((e) => {
      if (ctx.params.hold) {
        holding()
        return
      }
      if (base < 0) base = e.step
      const m = e.step - base
      if (m % 4 !== 0) return
      const i = Math.floor(m / 4) % notes.length
      idx = i
      const at = Math.max(e.time, ctx.audio.currentTime + 0.004)
      const dur = e.dur * 4

      const push = ctx.params.push * (1 - ctx.params.swell + ctx.params.swell * dyn[i])
      curPush = push
      curFreq = mtof(notes[i])
      P('freq').setValueAtTime(curFreq, at)
      P('level').setValueAtTime(push, at)

      // A brass note is a rise and a fall, not a pluck — and the level has to
      // be shaped outside the worklet or the propagation sees a step.
      // `push` is already the amplitude the worklet synthesises at, so putting
      // it in the envelope as well made the level go as push squared and put a
      // 2.4x spread between the defaults and the corners.
      const g = (0.5 + ctx.params.level * 0.7) * 0.53
      const shape = 0.45 + 0.55 * push
      amp.gain.cancelAndHoldAtTime(at)
      amp.gain.linearRampToValueAtTime(g * shape, at + Math.min(0.09, dur * 0.25))
      amp.gain.linearRampToValueAtTime(g * shape * 0.82, at + dur * 0.8)
      amp.gain.linearRampToValueAtTime(0.0001, at + dur * 0.97)
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          if (!ctx.params.hold) {
            amp.gain.cancelAndHoldAtTime(ctx.audio.currentTime)
            amp.gain.setTargetAtTime(0, ctx.audio.currentTime, 0.03)
          }
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    // One period of the sheared wave at the current σ, and its spectrum beside
    // the closed form. Recomputed only when σ moves enough to see.
    let shown = -1
    let wave: Float64Array<ArrayBufferLike> = new Float64Array(256)
    let amps: number[] = []
    let pred: number[] = []
    let steep = 1

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const s = ctx.params.linear ? 0 : Math.min(2.4, sigmaNow)
      if (Math.abs(s - shown) > 0.004) {
        shown = s
        const r = shearWave(256, Math.min(s, 0.999))
        wave = r.wave
        amps = harmonics(wave, HARMONICS).sin
        pred = Array.from({ length: HARMONICS }, (_, i) =>
          s <= SHOCK ? fubini(i + 1, Math.max(1e-6, s)) : sawtooth(i + 1, s),
        )
        steep = steepness(wave)
      }

      const half = (w - pad * 3) / 2
      const plotH = h - pad * 2 - 26
      const y0 = pad + 16

      // the waveform, one period
      g.strokeStyle = s >= SHOCK ? '#f87171' : '#7dd3fc'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= wave.length; i++) {
        const x = pad + (i / wave.length) * half
        const y = y0 + plotH / 2 - wave[i % wave.length] * plotH * 0.42
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()
      g.lineWidth = 1
      g.strokeStyle = '#1e293b'
      g.beginPath()
      g.moveTo(pad, y0 + plotH / 2)
      g.lineTo(pad + half, y0 + plotH / 2)
      g.stroke()

      // the spectrum: bars are what the wave has, ticks are the closed form
      const x1 = pad * 2 + half
      const bw = half / HARMONICS
      const top = (v: number) => y0 + plotH * (1 - Math.min(1, Math.abs(v)))
      for (let i = 0; i < HARMONICS; i++) {
        const x = x1 + i * bw
        g.fillStyle = i === 0 ? '#475569' : '#fbbf24'
        const yv = top(amps[i] ?? 0)
        g.fillRect(x + 1, yv, Math.max(1.5, bw - 3), y0 + plotH - yv)
        const yp = top(pred[i] ?? 0)
        g.strokeStyle = '#e2e8f0'
        g.beginPath()
        g.moveTo(x + 1, yp)
        g.lineTo(x + Math.max(2, bw - 2), yp)
        g.stroke()
      }

      g.font = '10px ui-monospace, monospace'
      g.fillStyle = '#64748b'
      g.fillText('one period', pad, y0 - 5)
      g.fillText(`harmonics — bars measured, ticks ${s <= SHOCK ? 'Fubini' : 'sawtooth'}`, x1, y0 - 5)

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = s >= SHOCK ? '#f87171' : '#94a3b8'
      const tag = ctx.params.linear ? 'linear — no steepening' : s >= SHOCK ? `σ ${s.toFixed(3)} — shock` : `σ ${s.toFixed(3)}`
      g.fillText(
        `${tag}   steepest ×${steep.toFixed(2)}   centroid ${centroid(amps).toFixed(2)}`,
        pad,
        h - pad,
      )
      g.fillStyle = '#64748b'
      g.fillText(
        `${curFreq.toFixed(0)} Hz   push ${curPush.toFixed(2)}   note ${idx + 1}/${notes.length}   iters ${itersNow}`,
        pad + Math.min(340, w * 0.46),
        h - pad,
      )
    })

    ctx.status('brightness from the air, not the reed')
  },
})
