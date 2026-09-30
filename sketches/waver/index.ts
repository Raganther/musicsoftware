import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, SCALES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { CONTROL_HZ, coeff, railStep, snap, spacing, survives, type RailState } from './rail'

/**
 * A pitch rail that corrects in time rather than in strength.
 *
 * `guardrail` (2026-09-04) measured the safety/expression trade along the
 * rail's *strength*, and found a cliff: from no help to full help the
 * vocabulary falls 61 → 8 notes an octave while the in-tune fraction goes
 * 13% → 100%. That axis cannot separate expression from error, because it
 * cannot tell a wobble from being flat — both are just distance from a degree,
 * and strength scales them by the same number.
 *
 * They differ in **frequency**. Being flat is slow; vibrato is fast. So lag the
 * *correction* instead of weakening it, and what survives is a one-pole
 * high-pass on the pitch error: a 6 Hz vibrato passes, a 0.2 Hz drift is pulled
 * out, one knob.
 *
 * It is exact only while the wobble stays inside one degree. Cross a snap
 * boundary and the system stops being linear, and what comes out is the warble
 * everyone can name.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-30-waver.md`.
 */

const TRACE = 900

export default defineSketch({
  title: 'Waver',
  description: 'Auto-tune with a time constant — vibrato survives, being flat does not.',
  tags: ['pitch', 'performance', 'generative'],
  status: 'promising',
  bpm: 76,
  division: 4,

  params: {
    /** The rail's time constant. 0 is an instantaneous rail, which is `guardrail`. */
    settle: { type: 'number', value: 60, min: 0, max: 600, step: 1, label: 'Settle (ms)', unit: 'ms' },
    /** `guardrail`'s axis, kept for comparison. It moves wobble and error together. */
    strength: { type: 'number', value: 1, min: 0, max: 1, step: 0.01, label: 'Rail strength' },
    /** Vibrato depth. Past half a snap step the rail stops being linear. */
    wobble: { type: 'number', value: 0.3, min: 0, max: 1.6, step: 0.01, label: 'Vibrato (semitones)' },
    rate: { type: 'number', value: 5.5, min: 0.5, max: 9, step: 0.1, label: 'Vibrato rate', unit: 'Hz' },
    /** Stay on one note instead of walking the line — the bench setting. */
    hold: { type: 'toggle', value: false, label: 'Hold one note' },
    /** The slow mistuning the rail is supposed to remove. */
    flat: { type: 'number', value: 0.35, min: 0, max: 0.8, step: 0.01, label: 'Slow error (semitones)' },
    root: { type: 'number', value: 55, min: 40, max: 70, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    colour: { type: 'number', value: 0.45, min: 0, max: 1, step: 0.01, label: 'Tone' },
    space: { type: 'number', value: 0.28, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
\`guardrail\` measured the safety/expression trade along the rail's
**strength**, and a strong rail is in tune and says nothing. That axis cannot
separate expression from error: a wobble and being flat are both just distance
from a degree, and strength scales them by the same number. Measured, with the
excursion kept inside one degree so the instant rail can actually null it:

| strength | 0 | 0.25 | 0.50 | 0.75 | 1.00 |
| --- | --- | --- | --- | --- | --- |
| vibrato kept | 0.9830 | 0.7372 | 0.4915 | 0.2457 | **0.0000** |
| slow error kept | 0.9911 | 0.7434 | 0.4956 | 0.2478 | **0.0000** |

Identical to three figures at every point. They differ in **frequency**, not in
size — so lag the correction instead of weakening it, and what survives is a
one-pole high-pass on the pitch error.

**Against the exact discrete transfer function**, over four time constants and
three rates, with the wobble inside one degree:

| τ (s) | 0.5 Hz | 2 Hz | 6 Hz |
| --- | --- | --- | --- |
| 0.02 | 0.058871 | 0.228830 | 0.565190 |
| 0.08 | 0.239958 | 0.697957 | 0.934430 |
| 0.30 | 0.683013 | 0.962551 | 0.991969 |

Measured over predicted was **1.0000 on 11 of 12**, the exception 0.9996.

**And that is what it buys**, a 6 Hz vibrato against a 0.2 Hz drift:

| τ (s) | 0.01 | 0.05 | 0.15 | 0.40 | 1.00 |
| --- | --- | --- | --- | --- | --- |
| vibrato kept | 0.311 | **0.862** | 0.977 | 0.995 | 0.998 |
| drift kept | 0.011 | **0.061** | 0.184 | 0.448 | 0.782 |
| ratio | 28.1 | **14.1** | 5.3 | 2.2 | 1.3 |

At 50 ms the rail removes 94% of the drift and 14% of the vibrato. The strength
axis reaches a ratio of **1.00** at every setting it has.

**The knee is exactly half a snap step.** Once the wobble crosses a boundary,
\`snap\` jumps and the rail is no longer a filter. At a 15 ms rail on a
chromatic scale:

| depth, in half-steps | 0.20 | 0.60 | 0.90 | **1.00** | **1.10** | 1.60 |
| --- | --- | --- | --- | --- | --- | --- |
| vibrato kept | 0.452 | 0.452 | 0.452 | 0.454 | **0.963** | 1.192 |
| warble | 0.0000 | 0.0000 | 0.0000 | 0.0135 | **0.1504** | 0.0193 |

Under the knee the linear answer holds to four decimals; over it a vibrato
**escapes the rail entirely** and takes a warble with it. And the warble belongs
to the fast rail: at a fixed depth of 1.8 half-steps it runs 0.1011 at τ = 0 and
falls to **0.0000** by τ = 0.3, because a slow rail is barely correcting at
6 Hz anyway. At τ = 0 the quantised sine's own fundamental is **1.18×** the
input's — a staircase is louder at the fundamental than the wave it came from.

**Off the sound**, tracking the pitch of a held note and projecting it onto the
two rates. The tracker's own window is a low-pass on the pitch track — 2.7% at
5.5 Hz — so its response is divided back out; otherwise it reads as the model
being wrong:

| settle | vibrato heard | predicted | ratio | slow error heard | predicted | ratio |
| --- | --- | --- | --- | --- | --- | --- |
| 0 ms | 0.0000 | 0.0000 | both 0 | 0.0001 | 0.0000 | both 0 |
| 15 ms | 0.4221 | 0.4229 | **0.998** | 0.0164 | 0.0173 | 0.948 |
| 60 ms | 0.8804 | 0.8821 | **0.998** | 0.0711 | 0.0736 | 0.965 |
| 150 ms | 0.9717 | 0.9737 | **0.998** | 0.1816 | 0.1837 | 0.989 |
| 400 ms | 0.9925 | 0.9943 | **0.998** | 0.4364 | 0.4477 | 0.975 |

And the strength axis, measured the same way: **0.984** between vibrato and slow
error at strength 0 and again at 0.5, with both reading zero at 1. It moves them
together in the sound exactly as it does in the model.

Levels: 0.510 at the defaults, 0.718 worst over ten settings.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // -- the voice -------------------------------------------------------------

    const osc = ctx.audio.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 220
    const lp = ctx.audio.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1400
    lp.Q.value = 3
    const amp = ctx.audio.createGain()
    amp.gain.value = 0
    osc.connect(lp).connect(amp).connect(bus)
    osc.start()

    ctx.cleanup(() => {
      disposeAt(osc, ctx.audio.currentTime + 0.05, [lp, amp])
      bus.disconnect()
      rev.dispose()
    })
    ctx.onParam('colour', (v) => lp.frequency.setTargetAtTime(500 + v * 3600, ctx.audio.currentTime, 0.05))
    lp.frequency.value = 500 + ctx.params.colour * 3600

    // -- the line --------------------------------------------------------------

    let notes: number[] = []
    let classes: number[] = []
    const build = () => {
      const r = rng(Math.round(ctx.params.seed))
      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      classes = [...(SCALES[scale] as readonly number[])].map((c) => (c + rootN) % 12).sort((a, b) => a - b)
      notes = []
      let d = 0
      for (let i = 0; i < 24; i++) {
        d = clamp(d + r.int(-2, 3), -2, 9)
        notes.push(degree(rootN, scale, d))
      }
    }
    build()
    for (const k of ['seed', 'root', 'scale'] as const) ctx.onParam(k, build)

    // -- the rail --------------------------------------------------------------

    const st: RailState = { c: 0 }
    let base = -1
    /** What the player did and what came out, for the drawing. */
    const traceIn: number[] = []
    const traceOut: number[] = []
    let phase = 0
    let driftPhase = 0
    let note = 0
    let glide = 0

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const k = e.step - base
      if (ctx.params.hold) note = notes[0]
      else if (k % 2 === 0) {
        note = notes[Math.floor(k / 2) % notes.length]
        glide = 1
      }

      const a = coeff(ctx.params.settle / 1000)
      const strength = ctx.params.strength
      const n = Math.max(2, Math.round(e.dur * CONTROL_HZ))
      const dt = 1 / CONTROL_HZ
      const wob = ctx.params.wobble
      const rate = ctx.params.rate
      const fl = ctx.params.flat

      for (let i = 0; i < n; i++) {
        phase += 2 * Math.PI * rate * dt
        driftPhase += 2 * Math.PI * 0.2 * dt
        // a short glide into each note, which a voice does and a rail should not fight
        glide = Math.max(0, glide - dt / 0.07)
        const from = traceIn.length ? traceIn[traceIn.length - 1] : note
        const centre = note + (from - note) * glide * glide

        const played = centre + wob * Math.sin(phase) + fl * Math.sin(driftPhase)
        const out = railStep(st, played, a, strength, classes)
        traceIn.push(played)
        traceOut.push(out)
        if (traceIn.length > TRACE) {
          traceIn.shift()
          traceOut.shift()
        }

        const t = e.time + i * dt
        const at = Math.max(t, ctx.audio.currentTime + 0.002)
        osc.frequency.linearRampToValueAtTime(mtof(out), at + dt)
      }

      // one long breath per note, so the line sustains rather than pulsing
      const lvl = 0.39 + ctx.params.level * 0.44
      const at = Math.max(e.time, ctx.audio.currentTime + 0.004)
      if (ctx.params.hold) {
        if (k === 0) {
          amp.gain.setValueAtTime(0, at)
          amp.gain.linearRampToValueAtTime(lvl, at + 0.08)
        }
      } else if (k % 2 === 0) {
        amp.gain.setValueAtTime(amp.gain.value, at)
        amp.gain.linearRampToValueAtTime(lvl, at + 0.05)
        amp.gain.linearRampToValueAtTime(lvl * 0.85, at + e.dur * 1.7)
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          const now = ctx.audio.currentTime
          amp.gain.cancelAndHoldAtTime(now)
          amp.gain.setTargetAtTime(0, now, 0.05)
          st.c = 0
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const plotH = h - pad * 2 - 20
      const y0 = pad + 4
      if (traceIn.length < 4) {
        g.fillStyle = '#64748b'
        g.font = '11px ui-monospace, monospace'
        g.fillText('press play', pad, h / 2)
        return
      }

      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < traceIn.length; i++) {
        lo = Math.min(lo, traceIn[i], traceOut[i])
        hi = Math.max(hi, traceIn[i], traceOut[i])
      }
      lo -= 1
      hi += 1
      const y = (p: number) => y0 + plotH * (1 - (p - lo) / (hi - lo))
      const x = (i: number) => pad + (i / (traceIn.length - 1)) * (w - pad * 2)

      // the allowed pitches — the rail's targets
      g.strokeStyle = '#1e293b'
      g.lineWidth = 1
      for (let p = Math.ceil(lo); p <= hi; p++) {
        if (Math.abs(snap(p, classes) - p) > 1e-6) continue
        g.beginPath()
        g.moveTo(pad, y(p))
        g.lineTo(w - pad, y(p))
        g.stroke()
      }

      const line = (arr: number[], colour: string, width: number) => {
        g.strokeStyle = colour
        g.lineWidth = width
        g.beginPath()
        for (let i = 0; i < arr.length; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, x(i), y(arr[i]))
        g.stroke()
      }
      line(traceIn, '#475569', 1)
      line(traceOut, '#7dd3fc', 1.7)
      g.lineWidth = 1

      const a = coeff(ctx.params.settle / 1000)
      const keep = ctx.params.strength * 0 + survives(a, ctx.params.rate)
      const drop = survives(a, 0.2)
      const half = spacing(classes) / 2
      const crossing = ctx.params.wobble > half

      g.font = '10px ui-monospace, monospace'
      g.fillStyle = '#475569'
      g.fillText('grey — played', pad, h - pad)
      g.fillStyle = '#7dd3fc'
      g.fillText('blue — railed', pad + 90, h - pad)

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = crossing ? '#f87171' : '#94a3b8'
      g.fillText(
        `vibrato kept ${(keep * ctx.params.strength + (1 - ctx.params.strength)).toFixed(3)}   slow error kept ${(drop * ctx.params.strength + (1 - ctx.params.strength)).toFixed(3)}`,
        pad + Math.min(200, w * 0.24),
        h - pad,
      )
      g.fillStyle = crossing ? '#f87171' : '#64748b'
      g.fillText(
        crossing
          ? `wobble ${(ctx.params.wobble / half).toFixed(2)} half-steps — past the knee, warbling`
          : `wobble ${(ctx.params.wobble / half).toFixed(2)} half-steps — linear`,
        pad + Math.min(480, w * 0.6),
        h - pad,
      )
    })

    ctx.status('vibrato is fast, being flat is slow')
  },
})
