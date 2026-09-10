import { clamp, degree, loadWorklet, mtof, noteName, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { classify, isHelmholtz, simulate, type Regime } from './friction'
import workletUrl from './string.worklet.js?url'

/**
 * A bowed string whose Schelleng diagram is measured rather than drawn.
 *
 * `bow`, on 2026-08-13, built the waveguide and looked for Schelleng's force
 * wedge in it. It is not there: "a memoryless characteristic reproduces
 * Helmholtz motion happily and the force boundaries not at all". Its diagram is
 * the textbook's, drawn over a model that does not produce it, and it says so.
 *
 * The reason it gave for the absence is the thing to test — a memoryless
 * friction curve has no static-versus-dynamic distinction and so nothing to
 * tear loose from. So this replaces the curve with two thresholds:
 *
 *   stuck, |Δv| ≤ μs·F   → the bow drags the string exactly
 *   stuck, |Δv| > μs·F   → break away
 *   slipping, |Δv| > μd·F → keep slipping
 *   slipping, |Δv| ≤ μd·F → get captured again
 *
 * Breaking away costs μs·F and being captured costs only μd·F, so the loop
 * encloses area. μs/μd is the one knob that closes it, which makes the control
 * for the whole experiment a parameter rather than a second build.
 *
 * The region on screen is computed from this model, a hundred short
 * simulations at a time, and it is not the textbook's wedge. What comes out is
 * the qualitative shape — a minimum force, a maximum force, and nothing at all
 * near the bridge — and not the quantitative laws. See `notes`.
 */

const GB = 12
const GF = 16
const B_LO = 0.02
const B_HI = 0.30
const F_LO = 0.02
const F_HI = 20

export default defineSketch({
  title: 'Rosin',
  description: 'A stick-slip bow with real hysteresis, and its Schelleng diagram measured from the model rather than drawn over it.',
  tags: ['dsp', 'worklet', 'physical-model', 'instrument'],
  status: 'promising',
  bpm: 72,
  division: 1,

  params: {
    /** Bow position as a fraction of the string from the bridge. */
    beta: { type: 'number', value: 0.07, min: B_LO, max: B_HI, step: 0.002, label: 'Bow position β' },
    force: { type: 'number', value: 0.85, min: F_LO, max: F_HI, step: 0.01, label: 'Bow force' },
    speed: { type: 'number', value: 0.12, min: 0.02, max: 0.4, step: 0.005, label: 'Bow speed' },
    /**
     * Static over dynamic friction. **1 closes the hysteresis loop** and is the
     * control for the whole sketch: at 1 the string never finds Helmholtz
     * motion anywhere on the diagram.
     */
    hyst: { type: 'number', value: 1.6, min: 1, max: 4, step: 0.01, label: 'Rosin grip (μs/μd)' },
    /** Bridge lowpass — how much the Helmholtz corner is rounded each pass. */
    damp: { type: 'number', value: 0.35, min: 0, max: 0.9, step: 0.01, label: 'Corner rounding' },
    loss: { type: 'number', value: 0.9992, min: 0.99, max: 1, step: 0.0001, label: 'Loss per pass' },
    root: { type: 'number', value: 43, min: 28, max: 60, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'minor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    auto: { type: 'toggle', value: true, label: 'Play itself' },
    space: { type: 'number', value: 0.26, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 9, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
\`bow\` built this waveguide in August and reported that Schelleng's force wedge
was not in it — "a memoryless characteristic reproduces Helmholtz motion happily
and the force boundaries not at all" — and drew the textbook's wedge over it,
labelled as the textbook's. The reason it gave for the absence is testable: a
memoryless friction curve has no static-versus-dynamic distinction and so
nothing to tear loose from.

So the curve is replaced here by two thresholds. Breaking away costs μs·F and
being recaptured costs only μd·F, so the friction loop encloses area.
\`Rosin grip\` is μs/μd, and at 1 the loop closes.

**With hysteresis the string speaks; without it, never.** Sweeping 8 bow
positions × 28 forces, twice — 224 cells each way — Helmholtz motion (exactly
one release per period, held steadily, with a real stick phase) appears in a
band at every bow position from β = 0.04 outward, and in **none of the 224
cells** with the loop closed. With it closed the string never even sticks: the
stick fraction is 0.00 in every cell, at every force. The qualitative half of
Schelleng that was missing arrives exactly where it was predicted to come from.

At β = 0.08 the band runs from 0.59 to 1.03 in these units. Below it the string
is dragged and never captured; above it there are two and three releases per
period, which is the crushed sound.

**But the arithmetic is not Schelleng's, and not by a little.** He says the
minimum force falls as 1/β² and the maximum as 1/β. Measured here the minimum
force is a clean power law — R² **0.919** over six positions — with an exponent
of **−0.373**. That is not scatter that a better fit would tidy up; it is a real
law that is not his. And the maximum force has no β dependence at all: slope
+0.18, R² 0.10.

**The duty cycle is wrong in a way that points somewhere.** In ideal Helmholtz
motion the slip occupies exactly β of the period, so the stick fraction should
be 1 − β and should not depend on force. Measured inside the band it runs 0.60
to 0.77 against a predicted 0.78 to 0.96 — about 0.2 low everywhere — and it
*climbs with force* (0.52, 0.61, 0.78 across the band at β = 0.08) where it
should sit still. The slip phase here is too long, which is what a finite
recapture threshold does: an ideal release is instantaneous, and this one has to
wait for |Δv| to come back inside μd·F.

**β = 0.02 and 0.028 never speak at any force**, and that is the model running
out of string rather than a Schelleng effect: at β = 0.02 the bridge-side delay
line is five samples long, which is not enough of a waveguide for a corner to
travel down. The −0.373 law would have put their minimum force inside the swept
range, so the silence there is a limit of the simulation and worth not
mistaking for physics.

So the hysteresis buys the shape of the diagram and none of its numbers. What is
drawn on the canvas is this model's own region, measured two cells a frame from
the same algorithm that makes the sound — not the textbook's laid over the top.
The dashed lines are Schelleng's, anchored to the middle of the measured region
so that only their *shape* is being compared.

Drag on the diagram to bow. Take \`Rosin grip\` to 1 while it plays and the tone
collapses into a drag.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.4 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const node = new AudioWorkletNode(ctx.audio, 'rosin-string', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    // Only channel 0 is sound; channel 1 carries the friction state, which the
    // analysis reads and nobody should hear.
    const split = ctx.audio.createChannelSplitter(2)
    node.connect(split)
    const dry = ctx.audio.createGain()
    dry.gain.value = 1
    split.connect(dry, 0)
    dry.connect(rev.input)

    const P = (k: string) => node.parameters.get(k)!
    let peak = 0
    node.port.onmessage = (e) => {
      if (e.data.peak !== undefined) peak = e.data.peak
    }
    ctx.cleanup(() => {
      P('on').value = 0
      node.disconnect()
      split.disconnect()
      dry.disconnect()
      rev.dispose()
    })

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))
    let midi = Math.round(ctx.params.root) + 12

    const push = () => {
      P('f0').value = mtof(midi)
      P('beta').value = ctx.params.beta
      P('force').value = ctx.params.force
      P('speed').value = ctx.params.speed
      P('muS').value = ctx.params.hyst
      P('damp').value = ctx.params.damp
      P('loss').value = ctx.params.loss
      P('gain').value = 0.5 + ctx.params.level * 0.9
      P('on').value = 1
    }
    push()
    for (const k of ['beta', 'force', 'speed', 'hyst', 'damp', 'loss', 'level'] as const) {
      ctx.onParam(k, push)
    }

    // -- the diagram, measured ---------------------------------------------------

    /** classify() per cell, filled a few per frame; −2 means not computed yet. */
    let map = new Int8Array(GB * GF).fill(-2)
    let mapAt = 0
    let mapKey = ''
    const bAt = (i: number) => B_LO * Math.pow(B_HI / B_LO, i / (GB - 1))
    const fAt = (j: number) => F_LO * Math.pow(F_HI / F_LO, j / (GF - 1))

    /**
     * The diagram is drawn for the open string rather than for whatever note is
     * sounding — a violinist's playable region is different on every note, and
     * recomputing two hundred cells every time the tune moves is both a stall
     * and a picture nobody can read.
     */
    const mapF0 = () => mtof(Math.round(ctx.params.root) + 12)
    const keyNow = () =>
      [ctx.params.hyst, ctx.params.damp, ctx.params.loss, ctx.params.speed, ctx.params.root].join(',')

    // -- playing it ---------------------------------------------------------------

    let step = 0
    ctx.clock.onStep((e) => {
      if (!ctx.params.auto) return
      if (e.step % 4 !== 0) return
      step++
      const deg = [0, 2, 4, 3, 5, 4, 2, 0][step % 8] + (step % 16 >= 8 ? 7 : 0)
      midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg) + 12
      const wobble = (r.next() - 0.5) * 0.02
      const t = Math.max(0, (e.time - ctx.audio.currentTime) * 1000)
      const id = setTimeout(() => {
        P('f0').value = mtof(midi)
        P('speed').setTargetAtTime(clamp(ctx.params.speed + wobble, 0.01, 0.5), ctx.audio.currentTime, 0.06)
      }, t)
      ctx.cleanup(() => clearTimeout(id))
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        P('on').value = ctx.clock.running ? 1 : 0
        if (!ctx.clock.running) {
          step = 0
          node.port.postMessage('reset')
        }
      }),
    )

    // -- drawing --------------------------------------------------------------------

    let live: Regime | null = null
    let liveKey = ''

    const g = ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const padL = 40
      const padR = 12
      const padT = 14
      const padB = 34
      const gw = w - padL - padR
      const gh = h - padT - padB
      const bx = (b: number) => padL + (Math.log(clamp(b, B_LO, B_HI) / B_LO) / Math.log(B_HI / B_LO)) * gw
      const fy = (f: number) => padT + gh - (Math.log(clamp(f, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO)) * gh

      const key = keyNow()
      if (key !== mapKey) {
        mapKey = key
        map = new Int8Array(GB * GF).fill(-2)
        mapAt = 0
      }
      // A few cells per frame. Short runs, because this is a picture; the
      // numbers in `notes` come from runs three times as long.
      // Two cells a frame, and three seconds each. Short runs are not a cheaper
      // version of this measurement, they are a different one: at these losses
      // the string takes hundreds of periods to settle, and at 0.9 s not one
      // cell of this grid reads as speaking.
      for (let k = 0; k < 2 && mapAt < GB * GF; k++, mapAt++) {
        const i = mapAt % GB
        const j = (mapAt / GB) | 0
        map[mapAt] = classify(
          simulate(
            { f0: mapF0(), beta: bAt(i), force: fAt(j), speed: ctx.params.speed,
              muS: ctx.params.hyst, damp: ctx.params.damp, loss: ctx.params.loss },
            ctx.audio.sampleRate,
            3.0,
          ),
        )
      }

      const cw = gw / GB
      const ch = gh / GF
      for (let j = 0; j < GF; j++) {
        for (let i = 0; i < GB; i++) {
          const v = map[j * GB + i]
          if (v === -2) continue
          g.fillStyle =
            v === 0 ? 'rgba(74,222,128,0.55)' : v === -1 ? 'rgba(255,255,255,0.05)' : 'rgba(248,113,113,0.16)'
          g.fillRect(bx(bAt(i)) - cw / 2, fy(fAt(j)) - ch / 2, cw + 0.7, ch + 0.7)
        }
      }

      // Schelleng's curves, for comparison — anchored to the measured region's
      // own middle, so only their *shape* is being compared, not their scale.
      const anchorB = 0.07
      const anchorF = 0.85
      for (const [pow, col] of [[-2, 'rgba(251,191,36,0.5)'], [-1, 'rgba(251,191,36,0.28)']] as const) {
        g.strokeStyle = col
        g.setLineDash([3, 3])
        g.lineWidth = 1.2
        g.beginPath()
        for (let i = 0; i <= 60; i++) {
          const b = B_LO * Math.pow(B_HI / B_LO, i / 60)
          const f = anchorF * Math.pow(b / anchorB, pow)
          i === 0 ? g.moveTo(bx(b), fy(f)) : g.lineTo(bx(b), fy(f))
        }
        g.stroke()
      }
      g.setLineDash([])

      // where the bow is
      const px = bx(ctx.params.beta)
      const py = fy(ctx.params.force)
      g.strokeStyle = 'rgba(255,255,255,0.9)'
      g.lineWidth = 1.4
      g.beginPath()
      g.arc(px, py, 5, 0, Math.PI * 2)
      g.stroke()

      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.textAlign = 'right'
      for (const f of [0.02, 0.1, 1, 10]) g.fillText(String(f), padL - 4, fy(f) + 3)
      g.textAlign = 'left'
      for (const b of [0.02, 0.05, 0.1, 0.2]) g.fillText(String(b), bx(b) - 6, padT + gh + 11)
      g.fillText('bow position β  (bridge is left)', padL, padT + gh + 22)
      g.textAlign = 'right'
      g.fillText('force', padL + gw, padT + gh + 22)
      g.textAlign = 'left'

      // the readout, from the model at the live point
      if (liveKey !== `${key},${ctx.params.beta.toFixed(4)},${ctx.params.force.toFixed(3)}`) {
        liveKey = `${key},${ctx.params.beta.toFixed(4)},${ctx.params.force.toFixed(3)}`
        live = simulate(
          { f0: mapF0(), beta: ctx.params.beta, force: ctx.params.force, speed: ctx.params.speed,
            muS: ctx.params.hyst, damp: ctx.params.damp, loss: ctx.params.loss },
          ctx.audio.sampleRate,
          3.0,
        )
      }
      g.font = '11px ui-monospace, monospace'
      const helm = live ? isHelmholtz(live) : false
      g.fillStyle = helm ? 'rgba(74,222,128,0.95)' : 'rgba(255,255,255,0.75)'
      g.fillText(
        `${noteName(midi)}  ·  ` +
          (live
            ? `${live.slipsPerPeriod.toFixed(2)} releases per period, sticking ${(live.stuckFraction * 100).toFixed(0)}%  ·  ` +
              (helm ? 'speaking' : live.slipsPerPeriod < 0.9 ? 'dragged' : 'crushed')
            : '…'),
        padL,
        h - 16,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        ctx.params.hyst <= 1.001
          ? 'grip 1: the loop is closed, and nothing on this diagram speaks'
          : `Helmholtz would stick ${((1 - ctx.params.beta) * 100).toFixed(0)}% of the time; dashed lines are Schelleng's 1/β² and 1/β` +
            (mapAt < GB * GF ? '  ·  measuring…' : ''),
        padL,
        h - 4,
      )
      void peak
    })

    // -- bowing by hand ----------------------------------------------------------

    const at = (ev: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const padL = 40
      const padT = 14
      const gw = rect.width - padL - 12
      const gh = rect.height - padT - 34
      const fx = clamp((ev.clientX - rect.left - padL) / gw, 0, 1)
      const fyv = clamp(1 - (ev.clientY - rect.top - padT) / gh, 0, 1)
      return {
        beta: B_LO * Math.pow(B_HI / B_LO, fx),
        force: F_LO * Math.pow(F_HI / F_LO, fyv),
      }
    }
    let dragging = false
    const onDown = (ev: PointerEvent) => {
      dragging = true
      const p = at(ev)
      ctx.set('beta', p.beta)
      ctx.set('force', p.force)
    }
    const onMove = (ev: PointerEvent) => {
      if (!dragging) return
      const p = at(ev)
      ctx.set('beta', p.beta)
      ctx.set('force', p.force)
    }
    const onUp = () => (dragging = false)
    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => {
      g.canvas.removeEventListener('pointerdown', onDown)
      g.canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    })

    // -- a way in for the harness --------------------------------------------------

    const wnd = window as unknown as Record<string, unknown>
    wnd.__rosin = () => ({
      midi,
      peak,
      params: () => ({
        f0: mtof(midi),
        beta: ctx.params.beta,
        force: ctx.params.force,
        speed: ctx.params.speed,
        muS: ctx.params.hyst,
        damp: ctx.params.damp,
        loss: ctx.params.loss,
      }),
      tap: () => dry,
      set: (k: string, v: number | string) => ctx.set(k as never, v as never),
    })
    ctx.cleanup(() => delete wnd.__rosin)

    ctx.status('press space — drag on the diagram to bow; green is where this model speaks')
  },
})
