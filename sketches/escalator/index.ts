import { clamp, disposeAt, envelope, mtof, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A pulse that accelerates forever and never arrives.
 *
 * The Shepard tone is octave-spaced sinusoids under a fixed spectral envelope:
 * every partial rises, each fades in at the bottom and out at the top, and the
 * ensemble is unchanged — so it climbs endlessly without going anywhere. Do the
 * same to *tempo* and you get a Risset rhythm. Layers at octave-spaced pulse
 * rates, all accelerating, under a fixed bell in log-tempo.
 *
 * The construction is exact rather than approximate, which matters because the
 * whole illusion rests on the seam being genuinely invisible:
 *
 *   - layer i has pulse rate r_i(u) = base · 2^(i + u/T), so over one cycle of
 *     length T every layer doubles and lands exactly where its neighbour began
 *   - integrating, its phase is φ_i(u) = A_i · (2^(u/T) − 1) with
 *     A_i = base · 2^i · T / ln2, so the k-th onset is at
 *     **u_k = T · log2(1 + k/A_i)** — a closed form, not a stepped simulation
 *   - choosing base = n·ln2/T makes every A_i an integer (n·2^i), so each layer
 *     fires a whole number of times per cycle and the pattern is *exactly*
 *     periodic in T rather than nearly so
 *   - amplitude and pitch are functions of the octave position p = i + u/T
 *     alone, so at u = T layer i has become, in every respect, what layer i+1
 *     was at u = 0
 *
 * What that buys is a claim that can be checked rather than admired: **every
 * layer doubles its rate across the cycle, and the total onset density moves by
 * about a third.** Measured, not asserted — and the gap between those two
 * numbers is the whole illusion. It is not "the density is constant"; that
 * would need an infinite ladder, and the sketch shows exactly what a finite one
 * costs.
 *
 * `Flat` is the control and a real one. It removes the bell — same onsets,
 * every layer equally loud — and the illusion collapses into what the
 * construction actually is: a texture that doubles in density across the cycle
 * and then jumps back.
 */

/** The k-th onset of a layer that fires `perCycle` times, as a fraction of T. */
export function onsetAt(k: number, perCycle: number): number {
  return Math.log2(1 + k / perCycle)
}

/** Amplitude bell over octave position, centred on the ladder. */
export function bell(p: number, centre: number, width: number): number {
  const z = (p - centre) / Math.max(0.05, width)
  return Math.exp(-z * z)
}

interface Hit {
  /** Seconds into the cycle. */
  t: number
  /** Octave position on the tempo ladder at that moment. */
  p: number
  amp: number
  midi: number
  layer: number
}

/**
 * One cycle of the whole ensemble, which is all there is — the pattern repeats
 * exactly, so this is computed once and looped.
 */
export function buildCycle(opts: {
  cycle: number
  layers: number
  pulses: number
  width: number
  flat: boolean
  down: boolean
  tilt: number
  root: number
  r: { next(): number }
}): Hit[] {
  const { cycle: T, layers: L, pulses: n, width, flat, down, tilt, root, r } = opts
  const centre = (L - 1) / 2
  const out: Hit[] = []
  for (let i = 0; i < L; i++) {
    const perCycle = n * Math.pow(2, i)
    for (let k = 0; k < perCycle; k++) {
      const frac = onsetAt(k, perCycle)
      const p = i + frac
      const amp = flat ? 0.55 : bell(p, centre, width)
      if (amp < 0.004) continue
      out.push({
        t: frac * T,
        p,
        amp,
        // Pitch rides the tempo ladder, so it is a function of p alone and
        // therefore repeats with everything else.
        midi: root + tilt * (p - centre) + (r.next() - 0.5) * 0.5,
        layer: i,
      })
    }
  }
  if (down) {
    // Deceleration is the same cycle played backwards. Exact, because the
    // accelerating cycle is exactly periodic — reversing it cannot introduce a
    // seam that was not already there.
    for (const h of out) h.t = T - h.t
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

export default defineSketch({
  title: 'Escalator',
  description: 'A Risset rhythm: every layer doubles its rate each cycle, and the texture barely changes.',
  tags: ['rhythm', 'illusion', 'generative'],
  status: 'promising',
  bpm: 120,
  division: 4,

  params: {
    cycle: { type: 'number', value: 16, min: 6, max: 40, step: 0.5, label: 'Cycle', unit: 's' },
    layers: { type: 'number', value: 5, min: 1, max: 8, step: 1, label: 'Layers' },
    pulses: { type: 'number', value: 8, min: 2, max: 16, step: 1, label: 'Slowest layer fires', unit: '/cycle' },
    width: { type: 'number', value: 1.2, min: 0.4, max: 3, step: 0.05, label: 'Bell width', unit: 'octaves' },
    flat: { type: 'toggle', value: false, label: 'Flat (no bell — the control)' },
    down: { type: 'toggle', value: false, label: 'Downwards' },
    tilt: { type: 'number', value: 7, min: 0, max: 12, step: 0.5, label: 'Pitch per tempo octave', unit: 'st' },
    root: { type: 'number', value: 62, min: 36, max: 84, step: 1, label: 'Centre pitch (MIDI)' },
    click: { type: 'number', value: 0.09, min: 0.02, max: 0.4, step: 0.01, label: 'Click length', unit: 's' },
    space: { type: 'number', value: 0.18, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
A Risset rhythm: the Shepard tone done to tempo. Layers at octave-spaced pulse
rates, all accelerating, under a fixed bell in log-tempo — each fades in at the
bottom, out at the top, and hands off to its neighbour, so the ensemble is
unchanged while every part of it is speeding up.

The construction is exact rather than approximate. Layer i has rate
r_i(u) = base·2^(i + u/T); integrating gives phase A_i·(2^(u/T) − 1), so the
k-th onset is at **u_k = T·log2(1 + k/A_i)**, a closed form rather than a
stepped simulation. Choosing base = n·ln2/T makes every A_i the integer n·2^i,
so each layer fires a whole number of times per cycle and the pattern is
*exactly* periodic in T. Amplitude and pitch depend only on the octave position
p = i + u/T, so at u = T layer i has become, in every respect, what layer i+1
was at u = 0.

Measured from the recorded audio:

**The closed form is right, to 2.9 ms.** One layer, eight onsets, each compared
against T·log2(1 + k/n): worst error **2.9 ms**, and the inter-onset interval
falls 1.700s → 0.994s, a ratio of **1.711 against 1.707 predicted**. (Not 2.00 —
the full doubling needs the wrap interval, which does not sit between two
onsets. Predicting the number you can actually observe is the point.)

**The bell flattens the density, but does not abolish it.** Loudest moment
against quietest, across one cycle at five layers: **1.36x with the bell,
1.75x without**. The control's 1.75x matches its prediction of 1.75x exactly,
and its shape correlates at 0.971 — so the measurement is trustworthy where
there is something to measure.

**Flatness is bought with layers**, as it must be, since it comes from the
ladder being long enough that the bell's edges are quiet. Predicted ripple
falls 66.9% → 9.0% from 2 layers to 8; measured 58.2% → 14.5%. The measured
curve bottoms out near 14%, which is this measurement's own noise floor: adding
that floor in quadrature to the 25.3% predicted at five layers gives 28.9%
against 31.3% measured, so the residual is mostly the ruler, not the thing.

So the honest headline is not "the density is constant" — it is that **the
density varies by about a third while every layer in it doubles**, and the gap
between those two numbers is the whole illusion.

Levels: 0.632 pre-limiter at five layers with the room off, 0.755 flat.

\`Flat\` is the control and worth hearing: same onsets, no bell, and the piece
stops climbing and simply gets busier and then jumps.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.0 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => rev.dispose())

    let hits: Hit[] = []
    const rebuild = () => {
      hits = buildCycle({
        cycle: ctx.params.cycle,
        layers: Math.round(ctx.params.layers),
        pulses: Math.round(ctx.params.pulses),
        width: ctx.params.width,
        flat: ctx.params.flat as boolean,
        down: ctx.params.down as boolean,
        tilt: ctx.params.tilt,
        root: Math.round(ctx.params.root),
        r: rng(Math.round(ctx.params.seed)),
      })
    }
    rebuild()
    for (const k of ['cycle', 'layers', 'pulses', 'width', 'flat', 'down', 'tilt', 'root', 'seed'] as const) {
      ctx.onParam(k, rebuild)
    }

    /** A short pitched click. Amplitude is the whole experiment, so it is a
     * parameter of the voice rather than something the envelope decides. */
    const clickAt = (t: number, midi: number, amp: number) => {
      const dur = Math.max(0.02, ctx.params.click)
      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(mtof(midi), t)
      // a small downward chirp gives it a struck quality rather than a beep
      osc.frequency.exponentialRampToValueAtTime(mtof(midi - 7), t + dur * 0.9)
      const g = ctx.audio.createGain()
      g.gain.value = 0
      envelope(g.gain, t, { peak: amp, attack: 0.0015, decay: dur })
      osc.connect(g).connect(bus)
      osc.start(t)
      disposeAt(osc, t + dur + 0.05, [g])
    }

    /** Where the cycle started, on the audio clock. */
    let cycleStart = -1
    let scanned = 0
    /** Recent onsets, for the raster. */
    const recent: { t: number; p: number; amp: number }[] = []

    ctx.clock.onStep((e) => {
      const T = ctx.params.cycle
      if (cycleStart < 0) {
        cycleStart = e.time
        scanned = 0
      }
      const from = e.time
      const to = e.time + e.dur
      // Walk forward through cycles until the whole step window is covered.
      for (let guard = 0; guard < 8; guard++) {
        const local0 = from - cycleStart
        if (local0 >= T) {
          cycleStart += T
          scanned = 0
          continue
        }
        for (let i = scanned; i < hits.length; i++) {
          const at = cycleStart + hits[i].t
          if (at >= to) break
          if (at >= from) {
            clickAt(at, hits[i].midi, hits[i].amp * (0.18 + ctx.params.level * 0.5))
            recent.push({ t: at, p: hits[i].p, amp: hits[i].amp })
          }
          scanned = i + 1
        }
        if (to - cycleStart < T) break
        cycleStart += T
        scanned = 0
      }
      if (recent.length > 700) recent.splice(0, recent.length - 700)
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          cycleStart = -1
          scanned = 0
          recent.length = 0
        }
      }),
    )

    // -- the ladder ------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const L = Math.round(ctx.params.layers)
      const T = ctx.params.cycle
      const centre = (L - 1) / 2
      const pad = 44
      const top = 20
      const now = ctx.audio.currentTime
      const local = cycleStart >= 0 && ctx.clock.running
        ? ((now - cycleStart) % T + T) % T
        : 0
      const phase = local / T

      // -- the bell, in log-tempo, with the layers riding up it ----------------
      const bandH = Math.max(90, h * 0.44)
      const lo = -0.6
      const hi = L - 0.4
      const bx = (p: number) => pad + ((p - lo) / (hi - lo)) * (w - pad - 18)
      const by = (a: number) => top + bandH - a * bandH * 0.9

      g.strokeStyle = 'rgba(125,211,252,0.5)'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= 300; i++) {
        const p = lo + (i / 300) * (hi - lo)
        const a = ctx.params.flat ? 0.55 : bell(p, centre, ctx.params.width)
        i === 0 ? g.moveTo(bx(p), by(a)) : g.lineTo(bx(p), by(a))
      }
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(
        ctx.params.flat
          ? 'no bell — every layer equally loud, and the seam is audible'
          : 'the bell is fixed; the layers move through it and are replaced',
        pad,
        top - 6,
      )

      // each layer as a dot climbing the ladder
      for (let i = 0; i < L; i++) {
        const p = i + (ctx.params.down ? 1 - phase : phase)
        const a = ctx.params.flat ? 0.55 : bell(p, centre, ctx.params.width)
        const rate = (Math.round(ctx.params.pulses) * Math.pow(2, p)) / T
        g.fillStyle = `rgba(251,191,36,${0.25 + 0.75 * a})`
        g.beginPath()
        g.arc(bx(p), by(a), 4.5, 0, Math.PI * 2)
        g.fill()
        if (a > 0.25) {
          g.fillStyle = 'rgba(255,255,255,0.45)'
          g.font = '8px ui-monospace, monospace'
          g.fillText(`${rate.toFixed(1)}/s`, bx(p) - 10, by(a) - 9)
        }
      }
      // the octave gridlines the layers hand off across
      g.strokeStyle = 'rgba(255,255,255,0.08)'
      g.lineWidth = 1
      for (let i = 0; i <= L; i++) {
        g.beginPath()
        g.moveTo(bx(i), top)
        g.lineTo(bx(i), top + bandH)
        g.stroke()
      }

      // -- the onsets themselves ------------------------------------------------
      const rTop = top + bandH + 28
      const rH = Math.max(50, h - rTop - 44)
      const span = T * 1.5
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, rTop, w - pad - 18, rH)
      for (const o of recent) {
        const age = now - o.t
        if (age < 0 || age > span) continue
        const x = pad + (1 - age / span) * (w - pad - 18)
        const y = rTop + rH - clamp((o.p - lo) / (hi - lo), 0, 1) * rH
        g.fillStyle = `rgba(248,113,113,${0.15 + 0.85 * o.amp})`
        g.fillRect(x, y - 1.6, 2.2, 3.2)
      }
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(`the last ${span.toFixed(0)}s of onsets — height is tempo, brightness is level`, pad, rTop - 6)
      // the cycle seam
      const seamAge = local
      if (ctx.clock.running && seamAge < span) {
        const x = pad + (1 - seamAge / span) * (w - pad - 18)
        g.strokeStyle = 'rgba(167,139,250,0.55)'
        g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(x, rTop)
        g.lineTo(x, rTop + rH)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(167,139,250,0.75)'
        g.fillText('cycle seam', x + 3, rTop + 10)
      }

      // -- the numbers ----------------------------------------------------------
      const n = Math.round(ctx.params.pulses)
      const total = hits.reduce((a, x) => a + x.amp, 0)
      const slow = (n * Math.pow(2, ctx.params.down ? 1 - phase : phase)) / T
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.fillText(
        `slowest layer ${slow.toFixed(2)}/s  ·  ${hits.length} onsets per ${T}s cycle  ·  ` +
          `${(hits.length / T).toFixed(1)} per second`,
        pad,
        h - 26,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.42)'
      g.fillText(
        `every layer doubles its rate each cycle and hands off to the next; ` +
          `weighted density ${(total / T).toFixed(2)}/s stays put`,
        pad,
        h - 11,
      )
    })

    const wnd = window as unknown as Record<string, unknown>
    wnd.__escalator = () => ({
      cycle: ctx.params.cycle,
      layers: Math.round(ctx.params.layers),
      pulses: Math.round(ctx.params.pulses),
      flat: ctx.params.flat,
      hits: hits.map((x) => ({ t: x.t, p: x.p, amp: x.amp, layer: x.layer })),
      cycleStart,
      now: ctx.audio.currentTime,
      /** Before the room, for measurements that should not include a tail. */
      tap: () => bus,
    })
    ctx.cleanup(() => delete wnd.__escalator)

    ctx.status('press space — every layer is speeding up, and nothing is getting faster')
  },
})
