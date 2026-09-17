import { clamp, degree, disposeAt, mtof, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { carriers, phantoms, ratio } from './phantom'

/**
 * Two melodies in contrary motion, neither of them in the signal.
 *
 * `tartini` put one tune into the difference tone between two carriers — in the
 * ear, not in the wire — and left a note asking for the other half: the
 * quadratic and cubic distortion products move in opposite directions, so one
 * carrier pair could hold two tunes.
 *
 * A = f2 − f1 and B = 2·f1 − f2 invert exactly: f1 = A + B, f2 = 2A + B. So if
 * the two tunes are strict mirrors of each other — one rising exactly as the
 * other falls, A + B held fixed — then **f1 never moves at all**. What you hear
 * is one steady tone and one sliding tone. What the ear manufactures is two
 * melodies going opposite ways, and there is no tone anywhere doing either.
 *
 * `Reveal` bends the output so the phantoms become real and you can check;
 * `Ghost` plays them as ordinary sines so you know what you are listening for.
 * Numbers in `notes` are measured; see `research/log/2026-09-17-contrary.md`.
 */

export default defineSketch({
  title: 'Contrary',
  description: 'Two melodies in contrary motion that exist only in the ear. One audible tone never moves at all.',
  tags: ['psychoacoustic', 'generative', 'strange'],
  status: 'promising',
  bpm: 76,
  division: 2,

  params: {
    /** mirror: B is A's frequency-mirror about `sum`, so f1 stands still. */
    mode: { type: 'select', value: 'mirror', options: ['mirror', 'free'], label: 'Second melody' },
    /**
     * A + B, in Hz — and in mirror mode this *is* the lower carrier, so it is
     * the one tone in the piece that never moves.
     */
    sum: { type: 'number', value: 1200, min: 700, max: 2200, step: 10, label: 'A + B (Hz)' },
    /** How far the phantom melody ranges. Also sets the carrier ratio. */
    span: { type: 'number', value: 0.62, min: 0.2, max: 1, step: 0.01, label: 'Melody span' },
    /**
     * Bend the output, so the phantoms stop being phantoms. A reveal control
     * belongs on every claim that something is absent.
     */
    reveal: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'Reveal (bend the output)' },
    /** One carrier to each ear. The cochlea needs both, so both tunes go. */
    dichotic: { type: 'toggle', value: false, label: 'One carrier per ear' },
    /** Play the two phantoms as ordinary sines, quietly, to compare against. */
    ghost: { type: 'toggle', value: false, label: 'Ghost (play them for real)' },
    root: { type: 'number', value: 50, min: 38, max: 64, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    glide: { type: 'number', value: 0.05, min: 0.002, max: 0.4, step: 0.002, label: 'Glide' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Two sine tones. Under them, two melodies moving in opposite directions, neither
of which any oscillator is playing.

A memoryless nonlinearity — which the ear is — turns two primaries into, among
much else, a quadratic difference tone at **f2 − f1** and a cubic one at
**2·f1 − f2**. Two equations, two unknowns, and they invert with nothing thrown
away: **f1 = A + B, f2 = 2A + B**. Round-tripped over 20,000 random pairs the
error is **0.00e+0 Hz**.

**Each melody comes from its own term.** With only the x² term, A measures
−20.0 dB and B sits at −277.4 — the arithmetic floor. With only x³, A is at
−271.0 and B at −28.5. Switching a term off deletes one tune and leaves the
other standing.

**The two phantoms cannot move the same way.** ∂A/∂f2 = +1 against ∂B/∂f2 = −1,
and ∂A/∂f1 = −1 against ∂B/∂f1 = +2. Nudging either carrier in either direction
moved them oppositely, 4 of 4.

**Which is what makes the instrument.** Hold A + B fixed — strict contrary
motion — and f1 = A + B **never moves**. One audible tone stands completely
still, the other slides one way, and two tunes go opposite ways underneath.

**Two *free* melodies do not hide nearly as well, and that is a real
constraint rather than a shortcoming of this implementation.** The ear only
makes these products when the carriers are close; f2/f1 = (2A+B)/(A+B) is near
1.2 only when B ≫ A; and then f1 = A + B simply follows B. Over 400 random note
pairs f1 correlates with B at **0.962** and f2 with B at 0.869. Two independent
melodies put one of them straight into the audible signal. Mirrored ones hide
both — and *only* mirrored ones do.

**Nothing else lands on either tune.** Over every intermodulation product
|m·f1 + n·f2| up to order five, the only ones at A are ±(f2−f1) and the only
ones at B are ±(2f1−f2), with **no other product within 30 Hz** of either.

The mirror melody is A reflected about \`A + B\` in *frequency*, not in log
frequency, so if A is in the scale B is not — it is in the scale's arithmetic
mirror. That is a real compositional object and the reason the two lines do not
sound like a transposition of each other.

**And all of it survives into the sound.** Recorded off the sketch's own bus,
then bent here rather than there — the wire is linear and the melodies only
exist once something is not:

| | in the recording | after bending it |
| --- | --- | --- |
| A | −164 to −211 dB | −30.6 dB |
| B | −164 to −171 dB | −43.9 dB |

**The bend brings them up by at least 120.4 dB.** Each still comes from its own
term: quadratic only gives A at −29.5 and leaves B at −169.5, cubic only gives B
at −42.7 and leaves A at −190.5.

**Split the carriers between the ears and both tunes go.** The capture takes one
channel, so with \`One carrier per ear\` that channel holds one primary and the
products cannot form: f2 falls from −10.8 dB to −160.7, and after bending A goes
from −30.6 to **−177.3** and B from −43.9 to **−160.4**. The two melodies need
both carriers in the same ear, which is where the nonlinearity is.

**And f1 really does stand still.** Over 40 notes in mirror mode it moves
**0.0 Hz** while f2 moves 114.8 and the two phantoms each move 115 in opposite
directions — A against B correlates at **−1.000**, and f1 against each of them at
0.000. Break the mirror and f1 moves 201.8 Hz.

Levels: 0.464 pre-limiter at the defaults, 0.797 at the loudest setting.
`,

  setup(ctx) {
    const out = ctx.audio.createGain()
    out.gain.value = 1

    // -- the bend, which is the reveal -----------------------------------------
    const shaper = ctx.audio.createWaveShaper()
    const CURVE = 2048
    const curve = new Float32Array(CURVE)
    const setCurve = (amt: number) => {
      for (let i = 0; i < CURVE; i++) {
        const x = (i / (CURVE - 1)) * 2 - 1
        curve[i] = clamp(x + amt * 0.9 * x * x + amt * 0.9 * x * x * x, -1, 1)
      }
      shaper.curve = curve
    }
    setCurve(0)
    ctx.onParam('reveal', setCurve)
    // x² makes DC as well as a difference tone; take it out
    const dc = ctx.audio.createBiquadFilter()
    dc.type = 'highpass'
    dc.frequency.value = 35
    out.connect(shaper).connect(dc).connect(ctx.out)
    ctx.cleanup(() => {
      out.disconnect()
      shaper.disconnect()
      dc.disconnect()
    })

    // -- the two carriers ------------------------------------------------------

    const mk = (pan: number) => {
      const o = ctx.audio.createOscillator()
      o.type = 'sine'
      const g = ctx.audio.createGain()
      g.gain.value = 0
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      o.connect(g).connect(p).connect(out)
      o.start()
      ctx.cleanup(() => {
        o.stop()
        o.disconnect()
        g.disconnect()
        p.disconnect()
      })
      return { o, g, p }
    }
    const v1 = mk(0)
    const v2 = mk(0)
    /** The ghosts: what you are supposed to be hearing, played for real. */
    const g1 = mk(-0.2)
    const g2 = mk(0.2)

    // -- the melody ------------------------------------------------------------

    /** Scale degrees for the A line; B is derived. */
    let line: number[] = []
    const build = () => {
      const r = rng(Math.round(ctx.params.seed))
      line = []
      let d = 4
      for (let i = 0; i < 24; i++) {
        d = clamp(d + r.int(-3, 3), 0, 11)
        line.push(d)
      }
    }
    build()
    ctx.onParam('seed', build)

    let step = 0
    /** Current state, for the drawing and the harness. */
    let cur = { a: 200, b: 1000, f1: 1200, f2: 1400 }
    const trail: { a: number; b: number; f1: number; f2: number }[] = []

    const aFor = (i: number) => {
      const S = ctx.params.sum
      // A lives in the bottom part of the sum; span says how much of it it uses
      const lo = S * 0.08
      const hi = S * 0.08 + S * 0.26 * ctx.params.span
      const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, line[i % line.length])
      const f = mtof(midi)
      // fold the scale tone into the usable window rather than clipping it
      let x = f
      while (x > hi) x /= 2
      while (x < lo) x *= 2
      return clamp(x, lo, hi)
    }

    ctx.clock.onStep((e) => {
      const S = ctx.params.sum
      const a = aFor(step)
      const b =
        ctx.params.mode === 'mirror'
          ? S - a
          : // free: an independent second line, which is what does NOT hide
            S - aFor(step * 7 + 3)
      const c = carriers(a, b)
      cur = { a, b, f1: c.f1, f2: c.f2 }
      trail.push(cur)
      if (trail.length > 64) trail.shift()

      const t = Math.max(e.time, ctx.audio.currentTime + 0.003)
      const gl = ctx.params.glide
      const lvl = 0.3 + ctx.params.level * 0.22
      const dich = ctx.params.dichotic
      v1.o.frequency.setTargetAtTime(c.f1, t, gl)
      v2.o.frequency.setTargetAtTime(c.f2, t, gl)
      v1.g.gain.setTargetAtTime(lvl, t, gl)
      v2.g.gain.setTargetAtTime(lvl, t, gl)
      v1.p.pan.setTargetAtTime(dich ? -1 : 0, t, 0.02)
      v2.p.pan.setTargetAtTime(dich ? 1 : 0, t, 0.02)

      const gg = ctx.params.ghost ? lvl * 0.4 : 0
      g1.o.frequency.setTargetAtTime(a, t, gl)
      g2.o.frequency.setTargetAtTime(b, t, gl)
      g1.g.gain.setTargetAtTime(gg, t, gl)
      g2.g.gain.setTargetAtTime(gg, t, gl)

      step++
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          const t = ctx.audio.currentTime
          for (const v of [v1, v2, g1, g2]) v.g.gain.setTargetAtTime(0, t, 0.05)
        }
      }),
    )
    void disposeAt

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const head = 15
      const S = ctx.params.sum
      const top = S * 2.0
      const yOf = (f: number) => pad + head + (h - pad * 2 - head) * (1 - clamp(f, 0, top) / top)

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `carriers ${cur.f1.toFixed(0)} + ${cur.f2.toFixed(0)} Hz (ratio ${ratio(cur.a, cur.b).toFixed(3)})` +
          `   phantoms ${cur.a.toFixed(0)} and ${cur.b.toFixed(0)}` +
          (ctx.params.reveal > 0 ? `   revealed` : `   not in the signal`),
        pad,
        pad + 10,
      )

      // the two bands: audible above, phantom below
      const x0 = pad
      const x1 = w - pad
      const xOf = (i: number) => x0 + ((x1 - x0) * i) / Math.max(1, trail.length - 1)

      const lines: [keyof typeof cur, string, boolean][] = [
        ['f1', '#7dd3fc', false],
        ['f2', '#7dd3fc', false],
        ['a', '#fbbf24', true],
        ['b', '#34d399', true],
      ]
      for (const [key, col, phantom] of lines) {
        g.strokeStyle = col
        g.lineWidth = phantom ? 1.6 : 2.2
        g.globalAlpha = phantom ? 0.95 : 0.55
        if (phantom && ctx.params.reveal === 0) g.setLineDash([4, 3])
        g.beginPath()
        for (let i = 0; i < trail.length; i++) {
          const y = yOf(trail[i][key])
          i === 0 ? g.moveTo(xOf(i), y) : g.lineTo(xOf(i), y)
        }
        g.stroke()
        g.setLineDash([])
        g.globalAlpha = 1
      }

      // labels at the right
      g.font = '9px ui-monospace, monospace'
      if (trail.length) {
        const last = trail[trail.length - 1]
        const tag = (f: number, s: string, col: string) => {
          g.fillStyle = col
          g.fillText(s, Math.min(w - pad - 62, xOf(trail.length - 1) + 4), yOf(f) + 3)
        }
        tag(last.f1, `f1 ${last.f1.toFixed(0)} heard`, 'rgba(125,211,252,0.75)')
        tag(last.f2, `f2 ${last.f2.toFixed(0)} heard`, 'rgba(125,211,252,0.75)')
        tag(last.a, `A ${last.a.toFixed(0)}`, '#fbbf24')
        tag(last.b, `B ${last.b.toFixed(0)}`, '#34d399')
      }

      // how still is f1?
      if (trail.length > 4) {
        const f1s = trail.map((p) => p.f1)
        const spread = Math.max(...f1s) - Math.min(...f1s)
        g.fillStyle = 'rgba(255,255,255,0.4)'
        g.fillText(
          `f1 has moved ${spread.toFixed(1)} Hz over the last ${trail.length} notes` +
            (ctx.params.mode === 'mirror' ? '' : '   (free mode — it follows B)'),
          pad + 2,
          h - pad,
        )
      }
    })

    const report = () => {
      const rr = ratio(cur.a, cur.b)
      ctx.status(
        `${cur.f1.toFixed(0)} and ${cur.f2.toFixed(0)} Hz, ratio ${rr.toFixed(2)}` +
          (rr > 1.35 ? ' — too wide for the ear to make the products' : '') +
          (ctx.params.mode === 'mirror' ? ' — f1 stands still' : ' — f1 follows B'),
      )
    }
    report()
    for (const k of ['sum', 'span', 'mode', 'root', 'scale'] as const) ctx.onParam(k, report)

    // Read back by the harness; the sketch's numbers come from the same module.
    ;(window as unknown as Record<string, unknown>).__contrary = () => ({
      // the pure two-sine bus, before the bend
      tap: () => out,
      // what the sketch actually emits, after it
      tapOut: () => dc,
      set: (k: string, v: number | boolean | string) => ctx.set(k as never, v as never),
      state: () => ({ ...cur }),
      trail: () => trail.slice(),
      check: () => phantoms(cur.f1, cur.f2),
    })
  },
})
