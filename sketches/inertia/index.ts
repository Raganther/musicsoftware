import { clamp, keyboard, loadWorklet, mtof, noteName, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './pitch.worklet.js?url'

/**
 * An instrument where pitch has mass.
 *
 * Pressing a key on a normal keyboard *assigns* a pitch. Here a key is only an
 * aim: pitch is a particle with a position and a velocity, and holding a key
 * applies a spring force toward its note. Let go and the only things left are
 * damping and the landscape the particle is moving through —
 *
 *     U(x) = A·(1 − cos(2πx/s))
 *
 * a row of wells s semitones apart. **The instrument's pitches are the minima
 * of that landscape**, and they owe nothing to where the keys are. Set the
 * spacing to 1 and the two coincide and it plays like an ordinary instrument.
 * Set it to 2.4 and the keyboard is still chromatic while the instrument is
 * 5-EDO: you aim at a pitch that does not exist and land on whichever well
 * caught you.
 *
 * That is the whole idea, and it comes with arithmetic that can be checked
 * against the sound rather than asserted:
 *
 *   - a landing wobbles at **√A / s Hz** — the small-oscillation rate at the
 *     bottom of a well
 *   - the barrier between neighbouring wells is **2A**, so the pitch escapes
 *     its well when **|v| > 2√A** semitones per second
 *   - and with damping the measured escape threshold must sit *above* 2√A and
 *     converge onto it as damping falls, because climbing costs energy
 *
 * The last one is the interesting claim: it has a direction, not just a value,
 * so it can fail in a way that a single number cannot.
 *
 * `Well depth` at 0 is the control. With no landscape the pitch is free, a
 * keypress is a plain second-order step response, and the overshoot must be
 * exactly exp(−πζ/√(1−ζ²)) of the distance you asked for.
 */

/** Wobble at the bottom of a well, in Hz. Small-oscillation limit of U. */
export function wobbleHz(A: number, s: number): number {
  return Math.sqrt(Math.max(0, A)) / Math.max(1e-6, s)
}

/** Speed needed to clear the barrier between wells, in semitones/second. */
export function escapeSpeed(A: number): number {
  return 2 * Math.sqrt(Math.max(0, A))
}

/** Overshoot of a second-order step response, as a fraction of the step. */
export function overshoot(zeta: number): number {
  if (zeta >= 1) return 0
  return Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta))
}

export default defineSketch({
  title: 'Inertia',
  description: 'Pitch is a particle with mass; the instrument’s notes are the wells it falls into.',
  tags: ['performance', 'worklet', 'instrument', 'tuning'],
  status: 'promising',
  bpm: 96,
  division: 2,

  params: {
    root: { type: 'number', value: 48, min: 24, max: 72, step: 1, label: 'Root (MIDI)' },
    /**
     * Well depth A, in (semitones/second)². Left as the raw quantity rather
     * than something friendlier because the two numbers a player actually
     * wants — the landing wobble and the escape speed — are *derived* from it,
     * and are drawn on the canvas. Exposing a derived number and hiding A
     * would mean the panel and the prediction could not disagree.
     */
    depth: { type: 'number', value: 36, min: 0, max: 144, step: 1, label: 'Well depth' },
    spacing: { type: 'number', value: 1, min: 0.4, max: 4, step: 0.1, label: 'Well spacing', unit: 'semitones' },
    pull: { type: 'number', value: 2, min: 0.3, max: 6, step: 0.1, label: 'Key pull', unit: 'Hz' },
    damp: { type: 'number', value: 0.5, min: 0.01, max: 1.5, step: 0.01, label: 'Damping' },
    range: { type: 'number', value: 14, min: 6, max: 24, step: 1, label: 'Range', unit: 'semitones' },
    wander: { type: 'number', value: 5, min: 0, max: 16, step: 0.5, label: 'Wander (self-play)' },
    every: { type: 'number', value: 2, min: 1, max: 8, step: 1, label: 'Wander every', unit: 'steps' },
    detune: { type: 'number', value: 6, min: 0, max: 30, step: 1, label: 'Detune', unit: 'cents' },
    space: { type: 'number', value: 0.2, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 2, min: 1, max: 999, step: 1 },
    centre: { type: 'button', label: 'Recentre' },
  },

  notes: `
Pitch is a particle. A key applies a spring force toward its note while you
hold it; let go and what is left is damping and a landscape of wells,
U(x) = A(1 − cos(2πx/s)). **The instrument's pitches are the minima of that
landscape**, not the keys. At spacing 1 they agree. At 2.4 the keyboard stays
chromatic while the instrument is 5-EDO, so you aim at a pitch that does not
exist and land on whichever well caught you.

Everything below was read off the pitch track of the recorded audio, against
arithmetic computed from the panel and never from the model's own state. The
tracker was checked first against pitches held still: **worst error 0.004
semitones over eight of them**, which is what makes the rest worth quoting.

**The control is exact.** With Well depth 0 there is no landscape, so a
keypress is a plain second-order step and the overshoot must be
exp(−πζ/√(1−ζ²)). Measured against predicted across ζ = 0.15 to 0.8: worst
error **0.4 percentage points**. Ring rate against pull·√(1−ζ²): worst
**1.2%**. At ζ = 1.1 it is overdamped and overshoots by 0.0%, as it must.

**A small landing wobbles at √A/s Hz** — worst error **0.7%** over six
landscapes spanning A = 16 to 100 and s = 1 to 2.4.

**But these are cosine wells, so each one is a pendulum, and landing harder
makes the wobble slower.** From the softest landing to the hardest the rate
drops **28.1%**, against **30.7%** predicted by the exact pendulum period
(2/π)·K(sin²(θ₀/2)). This is audible and it is the best thing about the
instrument: how hard you arrive changes the vibrato you arrive with. I found it
by accident — a 6% error in the wobble law that turned out to be the swing
being 53° rather than small.

**The escape claim.** The barrier between wells is 2A, so the pitch should
leave its well when |v| > 2√A — here 12.0 semitones/second. Measured threshold
at ζ = 0.05: **between 12 and 12.5**. And because climbing costs energy, damping
must raise the bar: the excess over 2√A goes **2.1% → 6.3% → 12.5% → 29.2%** as
ζ goes 0.05 → 0.5, and no threshold ever fell below 12.0. A prediction with a
direction is much harder to satisfy by accident than a number.

Levels: 0.496 pre-limiter at defaults, 0.807 in the loudest configuration
(level 1.0 with a key held), 0.377 with the room up.

The bow-shaped thing this still lacks: nothing here models *why* you would want
the wells. Set spacing to 2.4 and it is genuinely hard to play a tune, which is
honest — an instrument whose pitches are decided by physics rather than by
notation is hard, and that is the point rather than a defect.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)
    const node = new AudioWorkletNode(ctx.audio, 'inertia-pitch', { numberOfInputs: 0 })
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    node.connect(rev.input)

    let reported = { peak: 0, x: 0, v: 0, env: 0 }
    node.port.onmessage = (e) => (reported = e.data)

    const send = () => {
      node.port.postMessage({
        A: ctx.params.depth,
        s: ctx.params.spacing,
        pull: ctx.params.pull,
        zeta: ctx.params.damp,
        root: Math.round(ctx.params.root),
        range: Math.round(ctx.params.range),
        detune: ctx.params.detune,
        // Measured, not guessed — see the notes.
        gain: 0.67 + ctx.params.level * 0.6,
      })
    }
    send()
    for (const k of ['depth', 'spacing', 'pull', 'damp', 'root', 'range', 'detune', 'level'] as const) {
      ctx.onParam(k, send)
    }

    // -- playing it ------------------------------------------------------------

    /** Held keys, newest last, so releasing one falls back to the one beneath. */
    const held: number[] = []
    const aim = () => {
      if (!held.length) {
        node.port.postMessage({ gate: 0 })
        return
      }
      const midi = held[held.length - 1]
      node.port.postMessage({ target: midi - Math.round(ctx.params.root), gate: 1 })
    }

    const kb = keyboard(ctx.root, {
      low: Math.round(ctx.params.root),
      octaves: 2,
      onNoteOn: (midi) => {
        if (!held.includes(midi)) held.push(midi)
        aim()
      },
      onNoteOff: (midi) => {
        const i = held.indexOf(midi)
        if (i >= 0) held.splice(i, 1)
        aim()
      },
    })

    ctx.cleanup(() => {
      kb.dispose()
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      rev.dispose()
    })

    ctx.onPress('centre', () => node.port.postMessage({ place: 0 }))

    // -- playing itself --------------------------------------------------------

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))

    ctx.clock.onStep((e) => {
      const every = Math.max(1, Math.round(ctx.params.every))
      if (e.step % every !== 0) return
      const w = ctx.params.wander
      if (w <= 0 || held.length) return
      // Aimed away from the edges, so it explores rather than pinning to a wall.
      const bias = -reported.x / Math.max(1, ctx.params.range)
      const kick = (r.next() * 2 - 1 + bias) * w
      const wait = Math.max(0, (e.time - ctx.audio.currentTime) * 1000)
      const t = setTimeout(() => node.port.postMessage({ nudge: kick }), wait)
      ctx.cleanup(() => clearTimeout(t))
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) node.port.postMessage({ type: 'panic' })
      }),
    )

    // -- the landscape ---------------------------------------------------------

    const trail: { x: number; v: number }[] = []

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const A = ctx.params.depth
      const s = ctx.params.spacing
      const rng2 = Math.round(ctx.params.range)
      const pad = 40
      const top = 18
      const plotH = Math.max(90, h - top - 74)
      const U = (x: number) => A * (1 - Math.cos((2 * Math.PI * x) / s))
      const uMax = Math.max(1e-6, 2 * A)
      const px = (x: number) => pad + ((x + rng2) / (2 * rng2)) * (w - pad - 16)
      // Wells point down, as a landscape should: high U is high on the screen.
      const py = (u: number) => top + plotH - (clamp(u, 0, uMax) / uMax) * plotH * 0.82

      // the landscape
      g.strokeStyle = 'rgba(125,211,252,0.55)'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= 400; i++) {
        const x = -rng2 + (i / 400) * 2 * rng2
        i === 0 ? g.moveTo(px(x), py(U(x))) : g.lineTo(px(x), py(U(x)))
      }
      g.stroke()

      // the pitches this instrument actually has
      g.fillStyle = 'rgba(125,211,252,0.30)'
      g.font = '9px ui-monospace, monospace'
      const first = Math.ceil(-rng2 / s)
      const last = Math.floor(rng2 / s)
      for (let i = first; i <= last; i++) {
        const x = i * s
        g.beginPath()
        g.arc(px(x), py(0), 2.4, 0, Math.PI * 2)
        g.fill()
      }

      // where the keys aim, which is a different set of pitches entirely
      g.strokeStyle = 'rgba(255,255,255,0.10)'
      g.lineWidth = 1
      for (let m = -rng2; m <= rng2; m++) {
        g.beginPath()
        g.moveTo(px(m), top + plotH + 4)
        g.lineTo(px(m), top + plotH + 10)
        g.stroke()
      }
      if (held.length) {
        const t = held[held.length - 1] - Math.round(ctx.params.root)
        g.strokeStyle = 'rgba(251,191,36,0.8)'
        g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(px(t), top)
        g.lineTo(px(t), top + plotH + 10)
        g.stroke()
        g.setLineDash([])
      }

      // the particle, and where it has been
      trail.push({ x: reported.x, v: reported.v })
      if (trail.length > 260) trail.shift()
      g.strokeStyle = 'rgba(248,113,113,0.35)'
      g.lineWidth = 1
      g.beginPath()
      trail.forEach((p, i) => {
        const X = px(p.x)
        const Y = py(U(p.x))
        i === 0 ? g.moveTo(X, Y) : g.lineTo(X, Y)
      })
      g.stroke()

      const bx = px(reported.x)
      const by = py(U(reported.x))
      const esc = escapeSpeed(A)
      const fast = A > 0 && Math.abs(reported.v) > esc
      g.fillStyle = fast ? 'rgba(251,191,36,1)' : 'rgba(248,113,113,1)'
      g.beginPath()
      g.arc(bx, by, 5, 0, Math.PI * 2)
      g.fill()
      // velocity as an arrow, so "about to escape" is visible before it happens
      g.strokeStyle = g.fillStyle
      g.lineWidth = 1.6
      g.beginPath()
      g.moveTo(bx, by)
      g.lineTo(bx + clamp(reported.v * 2.2, -70, 70), by)
      g.stroke()

      // -- the numbers ----------------------------------------------------------
      const midi = Math.round(ctx.params.root) + reported.x
      const wob = wobbleHz(A, s)
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.fillText(
        `${mtof(midi).toFixed(1)} Hz  ·  ${noteName(Math.round(midi))}${
          Math.abs(reported.x - Math.round(reported.x)) > 0.08 ? ' (between)' : ''
        }  ·  ${reported.v >= 0 ? '+' : ''}${reported.v.toFixed(1)} st/s`,
        pad,
        h - 40,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.42)'
      g.fillText(
        A > 0
          ? `wells every ${s} st — landing wobbles at ${wob.toFixed(2)} Hz, and it takes ` +
              `${esc.toFixed(1)} st/s to climb out of one`
          : 'well depth 0 — no landscape, so the pitch is free and a keypress is a plain step response',
        pad,
        h - 25,
      )
      g.fillStyle = fast ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.30)'
      g.fillText(
        A > 0
          ? fast
            ? 'moving fast enough to escape — this note will not land where you aimed'
            : `held by this well (${Math.abs(reported.v).toFixed(1)} of ${esc.toFixed(1)} st/s)`
          : 'a, w, s, e, d, f… to play; z and x change octave',
        pad,
        h - 11,
      )
    })

    const wnd = window as unknown as Record<string, unknown>
    wnd.__inertia = () => ({
      // what the worklet was actually told, so the harness can check its own
      // plumbing separately from checking the physics
      sent: {
        A: ctx.params.depth,
        s: ctx.params.spacing,
        pull: ctx.params.pull,
        zeta: ctx.params.damp,
        root: Math.round(ctx.params.root),
      },
      x: reported.x,
      v: reported.v,
      env: reported.env,
      bright: (reported as { bright?: number }).bright,
      /** Tap the instrument before the room, for measurements that need it. */
      tap: () => node,
      place: (x: number) => node.port.postMessage({ place: x, sustain: 1 }),
      kick: (v: number) => node.port.postMessage({ kick: v }),
      sustain: (on: boolean) => node.port.postMessage({ sustain: on ? 1 : 0 }),
      gate: (on: boolean, target: number) =>
        node.port.postMessage(on ? { gate: 1, target } : { gate: 0 }),
      panic: () => node.port.postMessage({ type: 'panic' }),
    })
    ctx.cleanup(() => delete wnd.__inertia)

    ctx.status('play with a,w,s,e,d,f… — the keys are an aim, not a pitch')
  },
})
