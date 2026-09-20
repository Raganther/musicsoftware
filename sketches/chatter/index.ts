import { clamp, degree, loadWorklet, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './stick.worklet.js?url'
import {
  barModes,
  contactTime,
  loadedModes,
  MODAL_MASS,
  stiffness,
  type Mode,
} from './stick'

/**
 * A buzz roll is an inelastic collapse, and a bar is not a table.
 *
 * `mallet` hit a bar once and measured how long the contact lasted — 1–3 ms,
 * shorter the harder you hit, because Hertzian contact is a nonlinear spring.
 * Then it let go. This does not. A stick that is *held* against a bar bounces,
 * and the bounces do exactly what a ball dropped on a table does: gaps shrink
 * geometrically by the coefficient of restitution, there are infinitely many of
 * them, and the whole sequence finishes in finite time. That is Zeno's problem
 * with a real answer, and out loud it is a buzz roll — which is why a buzz
 * *accelerates* and then stops being a roll at all.
 *
 * The interesting part is where the textbook stops working. A table does not
 * push back. A bar is still ringing when the stick comes down again, and a
 * surface moving upward at the moment of impact hands energy back. So the
 * geometric law holds on a dead bar and fails on a live one, and a buzz lasts
 * an order of magnitude longer on something that rings. `Bar decay` is that
 * experiment and it is the whole sketch.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-20-chatter.md`.
 */

const MODES = 6

export default defineSketch({
  title: 'Chatter',
  description: 'A buzz roll is a ball bouncing to a stop — except the bar rings back, and that changes the arithmetic.',
  tags: ['dsp', 'worklet', 'physical-model', 'instrument'],
  status: 'promising',
  bpm: 92,
  division: 4,

  params: {
    /** The main knob: how hard the hand leans into the stick. */
    press: { type: 'number', value: 1, min: 0.05, max: 8, step: 0.05, label: 'Press', unit: 'N' },
    drop: { type: 'number', value: 0.9, min: 0.15, max: 3, step: 0.01, label: 'Drop speed', unit: 'm/s' },
    /**
     * The whole demonstration. Short is a practice pad, long is a marimba bar,
     * and the buzz lasts an order of magnitude longer on the second.
     */
    decay: { type: 'number', value: 1.6, min: 0.0005, max: 3, step: 0.0005, label: 'Bar decay', unit: 's' },
    /** Hertz exponent. 1 is a linear spring and is the control. */
    hardness: { type: 'number', value: 1.5, min: 1, max: 3, step: 0.01, label: 'Stick hardness (p)' },
    stiff: { type: 'number', value: 24, min: 4, max: 80, step: 0.5, label: 'Stick stiffness', unit: 'N' },
    mass: { type: 'number', value: 8, min: 2, max: 30, step: 0.5, label: 'Stick mass', unit: 'g' },
    every: { type: 'number', value: 8, min: 2, max: 16, step: 1, label: 'Drop every', unit: 'steps' },
    root: { type: 'number', value: 53, min: 36, max: 72, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMajor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Space' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
A stick you *hold* against a bar bounces, and the bounces are the textbook
bouncing ball: gaps shrinking geometrically by the coefficient of restitution,
infinitely many of them, the whole sequence over in finite time. Inelastic
collapse — Zeno with an answer. Out loud that is a buzz roll, and it is why a
buzz accelerates and then stops being a roll.

**The contact time is exact, not a fit.** For m·c̈ = −k·c^p the quadrature closes
in Beta functions, t_c = (2·c_max/v)·B(1/(p+1), ½)/(p+1). At p = 1 that must
reduce to half a period of a mass on a spring, π√(m/k), and it does — **exactly,
to nine figures, in 9 of 9 cells**. Against the integrator on a rigid bar the
worst departure is 3.06%, every error is about a third of a sample, and raising
the sample rate ×64 walks the ratio **0.99247 → 0.99968**. The 3% was the sample
period, not the model.

**Restitution is velocity-independent only at p = 1.** The linear spring gives
0.8401 / 0.8400 / 0.8401 / 0.8403 over a 30× speed range; at p = 3 the same
sweep falls **0.9047 → 0.6875**. A harder strike bounces less well — the same
nonlinearity \`mallet\` found in the contact time, from the other side.

**And a bar is not a table.** A table does not push back. A bar is still ringing
when the stick comes down, and a surface moving up at the moment of impact hands
energy back, so the geometric law is a statement about *dead* bars:

| bar decay | bounces | gap ratio ÷ e | collapse ÷ ballistic |
| --- | --- | --- | --- |
| 0.6 ms | 20 | **1.028** | 1.36 |
| 8 ms | 20 | 1.028 | 1.36 |
| 40 ms | 20 | 1.028 | 1.36 |
| 0.3 s | 51 | 1.177 | 3.60 |
| 2.4 s | 496 | **1.254** | **28.55** |

The first three rows are identical to four figures: under about 40 ms of ring a
bar might as well be a table. **A buzz lasts 5.3–20.0× longer on one that
rings**, and off the recording the chattering runs **0.051 s → 1.928 s** (9
impacts → 202) as \`Bar decay\` goes 2 ms → 3 s. That is one slider, and it is
why a buzz on a practice pad dies and a buzz on a marimba goes on.

**The bounce count is not an observable.** Perturbing the drop speed by one part
in 10¹⁵ — the last bit of a double — moves it by 2.3%, and by 10¹² moves it
23.6%. A ball bouncing on a vibrating surface is chaotic. The worklet and the
model agree *exactly* (19 and 19, 77 and 77 bounces; collapse to 0.1 ms) on the
short-decay settings where it is not, and diverge on the long ones where it is.

**What is not true:** I predicted the collapse would end when the gap fell below
the contact time, since below that the next impact starts before the last one
ends. It does not — the final gaps run **0.02–0.13× t_c**. Tidy, and wrong.

**Half-true:** a stuck stick is an attached mass, so the pressed bar should be a
two-oscillator avoided crossing. The lower branch is measured within 3–7% of the
closed form at a light press, and at a heavy one there is nothing left to
measure — the stick damps the bar so hard the tone is gone before the collapse
finishes. The control is clean: struck and barely pressed reads **+4 cents**.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)
    const node = new AudioWorkletNode(ctx.audio, 'chatter-stick', { numberOfInputs: 0 })
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.4 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    node.connect(bus)
    bus.connect(rev.input)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      bus.disconnect()
      rev.dispose()
    })

    type Report = {
      peak: number
      raw: number
      bounces: number
      firstGapMs: number
      lastGapMs: number
      contactMs: number
      collapsedMs: number
      touching: boolean
      bad: number
      trace: number[]
    }
    let report: Report = {
      peak: 0, raw: 0, bounces: 0, firstGapMs: 0, lastGapMs: 0,
      contactMs: 0, collapsedMs: -1, touching: false, bad: 0, trace: [],
    }
    let rawMax = 0
    node.port.onmessage = (e) => {
      report = e.data
      if (report.raw > rawMax) rawMax = report.raw
    }

    // -- the bar ---------------------------------------------------------------

    let modes: Mode[] = []
    let pitch = 53
    const setBar = (p: number) => {
      pitch = p
      modes = barModes(mtof(p), MODES, ctx.params.decay)
      node.port.postMessage({ modes })
    }
    /**
     * What a strike puts into the bar is momentum, not force.
     *
     * The impulse of a Hertzian contact is (1+e)·m·v — the peak force and the
     * contact time both depend on stiffness and hardness and the two cancel,
     * which is why those knobs change the *timbre* and mass and drop speed
     * change the *level*. Across the panel that is a 12.5x spread, so it is
     * normalised out at 0.75, leaving about 1.9x of real dynamics. Without it
     * the worklet's runaway clamp engages at the loud end, which it did.
     */
    const REF = 0.008 * 0.9
    let lastGain = 0
    const send = () => {
      const m = ctx.params.mass / 1000
      const impulse = (m * ctx.params.drop) / REF
      lastGain = (0.35 + ctx.params.level * 0.5) / Math.pow(impulse, 0.75)
      node.port.postMessage({
        hardness: ctx.params.hardness,
        stiff: ctx.params.stiff,
        mass: m,
        press: ctx.params.press,
        gain: lastGain,
      })
    }
    send()
    setBar(53)
    for (const k of ['hardness', 'stiff', 'mass', 'press', 'level', 'drop'] as const) ctx.onParam(k, send)
    ctx.onParam('decay', () => setBar(pitch))

    // -- the line --------------------------------------------------------------

    let r = rng(Math.round(ctx.params.seed))
    let deg = 0
    const reseed = () => {
      r = rng(Math.round(ctx.params.seed))
      deg = 0
    }
    ctx.onParam('seed', reseed)

    let base = -1
    let drops = 0
    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const every = Math.round(ctx.params.every)
      if ((e.step - base) % every !== 0) return
      deg = clamp(deg + r.int(-2, 3), -3, 9)
      setBar(degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg))
      // a real hand is not a machine: ±15% on the drop, from the seed
      node.port.postMessage({ drop: ctx.params.drop * (0.85 + r.next() * 0.3) })
      drops++
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          node.port.postMessage({ type: 'lift' })
          reseed()
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const head = 15

      const k = stiffness(ctx.params.stiff, ctx.params.hardness)
      const m = ctx.params.mass / 1000
      const tc = contactTime(m, k, ctx.params.hardness, ctx.params.drop)
      const c0 = Math.pow(ctx.params.press / k, 1 / ctx.params.hardness)
      const kEff = ctx.params.hardness * k * Math.pow(c0, ctx.params.hardness - 1)
      const f0 = mtof(pitch)
      const lm = loadedModes(f0, MODAL_MASS, m, kEff)

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `contact ${(tc * 1000).toFixed(2)} ms   bounces ${report.bounces}` +
          `   gap ${report.firstGapMs.toFixed(1)} → ${report.lastGapMs.toFixed(2)} ms` +
          (report.collapsedMs > 0 ? `   collapsed at ${report.collapsedMs.toFixed(0)} ms` : '   still bouncing') +
          // The pressed bar is an avoided crossing, not one detuned note, and
          // when the contact is soft the *lower* root is the stick's own mode
          // rather than the bar's — so name both rather than a cents figure
          // that would be reporting the wrong branch.
          `   free ${f0.toFixed(0)} Hz, pressed ${lm.lo.toFixed(0)}+${lm.hi.toFixed(0)}` +
          (report.bad ? `   ${report.bad} NaN` : ''),
        pad,
        pad + 10,
      )

      const top = pad + head
      const avail = h - top - pad
      const traceH = Math.max(60, avail * 0.62)
      const rasterTop = top + traceH + 8
      const rasterH = Math.max(26, avail - traceH - 8)

      // -- the bounce trace ------------------------------------------------------
      // stick minus bar surface: above the line is airborne, below is squashed.
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, top, w - pad * 2, traceH)
      const tr = report.trace
      const zero = top + traceH * 0.9
      g.strokeStyle = 'rgba(255,255,255,0.18)'
      g.beginPath()
      g.moveTo(pad, zero)
      g.lineTo(w - pad, zero)
      g.stroke()
      if (tr.length > 1) {
        let lo = 0
        for (const v of tr) if (v < lo) lo = v
        const span = Math.max(1e-3, -lo)
        g.strokeStyle = '#7dd3fc'
        g.lineWidth = 1.2
        g.beginPath()
        for (let i = 0; i < tr.length; i++) {
          const x = pad + (i / (tr.length - 1)) * (w - pad * 2)
          // negative (airborne) goes up; positive (in contact) goes down a little
          const y = tr[i] < 0 ? zero + (tr[i] / span) * (traceH * 0.82) : zero - 2
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.font = '9px ui-monospace, monospace'
        g.fillText(`stick height, ${((tr.length * 64) / ctx.audio.sampleRate).toFixed(2)} s`, pad + 5, top + traceH - 4)
        g.fillText('touching the bar', pad + 5, zero - 5)
        g.font = '11px ui-monospace, monospace'
      }

      // -- the contacts, as a raster --------------------------------------------
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, rasterTop, w - pad * 2, rasterH)
      if (tr.length > 1) {
        for (let i = 0; i < tr.length; i++) {
          if (tr[i] <= 0) continue
          const x = pad + (i / (tr.length - 1)) * (w - pad * 2)
          g.fillStyle = report.collapsedMs > 0 && i / tr.length > report.collapsedMs / ((tr.length * 64000) / ctx.audio.sampleRate)
            ? '#f472b6'
            : '#fbbf24'
          g.fillRect(x, rasterTop + 4, 2, rasterH - 8)
        }
      }
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(
        `in contact — pink is after the collapse · bar ${f0.toFixed(0)} Hz, decay ${ctx.params.decay < 0.01 ? (ctx.params.decay * 1000).toFixed(1) + ' ms' : ctx.params.decay.toFixed(2) + ' s'} · ${drops} drops`,
        pad + 4,
        rasterTop + rasterH - 4,
      )
    })

    // -- for the harness --------------------------------------------------------
    const api = {
      set: (key: string, v: unknown) => ctx.set(key as never, v as never),
      report: () => report,
      rawMax: () => rawMax,
      pitch: () => pitch,
      modes: () => modes,
      drop: (v: number) => node.port.postMessage({ drop: v }),
      /** Silence the bar, so a comparison starts from the same state the model does. */
      quiet: () => node.port.postMessage({ type: 'panic' }),
      gain: () => lastGain,
      bar: (p: number) => setBar(p),
      tap: () => bus,
    }
    ;(window as unknown as Record<string, unknown>).__chatter = () => api
    ctx.cleanup(() => delete (window as unknown as Record<string, unknown>).__chatter)
  },
})
