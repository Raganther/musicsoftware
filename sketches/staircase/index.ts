import { clamp, disposeAt, mtof, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A rhythm that speeds up forever and never gets anywhere.
 *
 * `crossing`, two days ago, accelerates for real: the tempo goes up and stays
 * up, and the piece ends somewhere different from where it began. This is the
 * lie. Every layer is genuinely, continuously accelerating — and the whole
 * thing repeats exactly. Risset's rhythmic version of the Shepard tone.
 *
 * The construction: several pulse layers, each sliding up through the same
 * four octaves of tempo, evenly spaced so that at any instant they are at
 * different heights on the same staircase. Each layer's loudness is a bell
 * over its position, so it is silent when it enters at the bottom and silent
 * again when it leaves at the top. The jump from top back to bottom therefore
 * happens under cover of zero amplitude, which is the entire trick: nothing
 * you can hear ever goes down.
 *
 * A layer's tempo doubles every L/S seconds, so its rate is r0·e^{ku} with
 * k = S·ln2/L, and its nth pulse falls at u_n = ln(1 + n·k/r0)/k. Same closed
 * form as `crossing` and for the same reason — placing pulses by adding
 * intervals would drift, and the whole claim is that the cycle closes exactly.
 *
 * \`Seam\` is the control. At 0 the bell is in place and the illusion holds. Turn
 * it up and the weighting flattens until every layer is equally loud all the
 * way through, at which point you hear each one snap back to the bottom and the
 * staircase becomes an ordinary loop. Same notes, same tempos, no illusion.
 */

interface Layer {
  /** Next pulse index within this layer's cycle. */
  n: number
  /** Audio time at which this layer's position was 0. */
  cycleStart: number
  midi: number
  pan: number
}

export default defineSketch({
  title: 'Staircase',
  description: 'Every layer accelerates forever. The whole thing repeats exactly. Risset’s rhythm.',
  tags: ['strange', 'rhythm', 'psychoacoustics'],
  status: 'promising',
  bpm: 100,
  division: 4,

  params: {
    layers: { type: 'number', value: 6, min: 3, max: 8, step: 1, label: 'Layers' },
    cycle: { type: 'number', value: 24, min: 6, max: 60, step: 1, label: 'Cycle', unit: 's' },
    octaves: { type: 'number', value: 4, min: 1, max: 6, step: 1, label: 'Tempo range', unit: 'oct' },
    slowest: { type: 'number', value: 0.8, min: 0.2, max: 3, step: 0.05, label: 'Slowest rate', unit: '/s' },
    seam: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'Seam (1 breaks it)' },
    loose: { type: 'number', value: 0.12, min: 0, max: 1, step: 0.01, label: 'Humanise' },
    decay: { type: 'number', value: 0.3, min: 0.04, max: 1.2, step: 0.01, label: 'Ping length', unit: 's' },
    space: { type: 'number', value: 0.26, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 38, min: 28, max: 50, step: 1, label: 'Root (MIDI)' },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1 },
    restart: { type: 'button', label: 'Back to the bottom' },
  },

  notes: `
\`crossing\` accelerates for real and ends somewhere different from where it
started. This is the lie. Every layer here is genuinely, continuously
accelerating — and the whole thing repeats exactly. Risset's rhythmic Shepard
tone.

Several pulse layers slide up through the same four octaves of tempo, evenly
spaced so they are always at different heights on one staircase. Each layer's
loudness is a bell over its position: silent entering at the bottom, silent
leaving at the top. The jump from top back to bottom therefore happens under
cover of zero amplitude. Nothing you can hear ever goes down.

Pulses are placed from the closed form u_n = ln(1 + n·k/r0)/k with
k = S·ln2/L — the same one \`crossing\` uses, and for the same reason: the
claim is that the cycle closes exactly, and adding intervals would drift.

**Measured** at 4 layers, 12 s cycle, 4 octaves, slowest 0.8/s:

**The whole thing repeats, and only at the cycle.** Correlating the stack of
per-band envelopes — which knows *which* layer is doing what:

| lag | 3 s (L/4) | 6 s (L/2) | 12 s (L) |
| --- | --- | --- | --- |
| by layer | −0.18 | −0.23 | **0.960** |
| mix envelope alone | 0.938 | 0.930 | 0.947 |

The second row is the more interesting one. The envelope of the mix is deaf to
pitch, so it repeats every time the layers merely swap places — the *rhythm*
recurs four times as often as the *sound* does, and that is a large part of why
the illusion holds. A search over every lag from 1 to 14 s finds the strongest
true repeat at **12.00 s**, exactly the cycle.

**The wrap really is silent**, and \`Seam\` is the control. Band energy at each
layer's own wrap instant, relative to that layer at its loudest:

| seam | 0 | 0.5 | 1 |
| --- | --- | --- | --- |
| energy at the wrap | **2.9%** | 62.9% | 122.5% |

**Each layer doubles four times across the cycle.** Rate measured at p = 0.25
and p = 0.75, which are half a cycle apart and so should differ by 2^(4/2) = 4:
**5.20, 4.38, 4.20** for the upper three layers. The estimator biases high —
it takes the *longest* intervals in a window, because the detector invents
extra onsets but never misses real ones, and extras can only shorten an
interval.

One honest failure. The lowest layer sits at 92 Hz and its band cannot be
cleaned up: 231 onsets heard where 90 exist, only 45 of them matching a
predicted pulse, with ±32 ms of scatter. Every other layer matched **every**
audible pulse (106/106, 73/73, 79/79) with 13–30 ms of lag. The other layers'
attack transients are broadband enough to dominate a band that low, and I did
not solve it — so the doubling figures rest on the upper three.

Pre-limiter peak 0.521.
`,


  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.4 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // Pure sines, an octave apart per layer. A sine has no harmonics, so each
    // layer sits in a band of its own and an analyser can say whose pulse is
    // whose — which is what makes "every layer is accelerating" checkable
    // rather than merely asserted.
    const ping = (midi: number, time: number, gain: number, pan: number) => {
      if (gain < 0.002) return
      const osc = ctx.audio.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = mtof(midi)
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      osc.connect(amp).connect(p).connect(bus)
      const d = ctx.params.decay
      amp.gain.setValueAtTime(0, time)
      // 8 ms rather than 3: a fast ramp on a sine is still a broadband click,
      // and the splatter lands in every other layer's band at the same instant.
      amp.gain.linearRampToValueAtTime(gain, time + 0.008)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.02), time + d)
      osc.start(time)
      disposeAt(osc, time + d + 0.05, [amp, p])
    }

    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the staircase ---------------------------------------------------------

    let layers: Layer[] = []
    let origin = -1
    let r = rng(Math.round(ctx.params.seed))

    /** How fast a layer at position p (0..1) is going. */
    const rateAt = (p: number) =>
      ctx.params.slowest * Math.pow(2, ctx.params.octaves * clamp(p, 0, 1))

    /**
     * How loud a layer at position p is. A raised cosine, zero at both ends —
     * which is what hides the jump from the top of the staircase back to the
     * bottom. `seam` flattens it toward equal loudness, and the illusion goes.
     */
    const weightAt = (p: number) => {
      const bell = 0.5 * (1 - Math.cos(2 * Math.PI * clamp(p, 0, 1)))
      return bell + (1 - bell) * ctx.params.seam
    }

    /** When a layer's nth pulse falls, seconds into its own cycle. */
    const timeOfPulse = (n: number) => {
      const L = ctx.params.cycle
      const k = (ctx.params.octaves * Math.LN2) / L
      return Math.log(1 + (n * k) / ctx.params.slowest) / k
    }

    const build = () => {
      const N = Math.round(ctx.params.layers)
      const L = ctx.params.cycle
      const root = Math.round(ctx.params.root)
      r = rng(Math.round(ctx.params.seed))
      layers = []
      for (let i = 0; i < N; i++) {
        layers.push({
          n: 0,
          // Evenly spaced around the staircase: layer i starts i/N of the way
          // up, which is what makes the ensemble look the same at every moment.
          cycleStart: -((i * L) / N),
          midi: root + 12 * i,
          pan: N === 1 ? 0 : (i / (N - 1) - 0.5) * 1.3,
        })
      }
      origin = -1
    }
    build()
    for (const k of ['layers', 'cycle', 'octaves', 'slowest', 'root', 'seed'] as const)
      ctx.onParam(k, build)

    const restart = () => {
      origin = -1
      build()
    }
    ctx.onPress('restart', restart)
    ctx.cleanup(ctx.clock.onStateChange(() => !ctx.clock.running && restart()))

    // The transport is only a metronome for the scheduler — the layers do not
    // sit on its grid, which is the point.
    ctx.clock.onStep((e) => {
      if (origin < 0) {
        origin = e.time
        for (const l of layers) l.cycleStart += origin
        // fast-forward each layer to its starting position
        for (const l of layers) {
          while (l.cycleStart + timeOfPulse(l.n) < origin) l.n++
        }
      }
      const L = ctx.params.cycle
      const horizon = e.time + e.dur * 2
      // Divided by sqrt(layers): the bell means roughly half of them are
      // audible at once and they sum incoherently, so without this, adding
      // layers changes the loudness instead of the texture.
      const gain = (1.1 + ctx.params.level * 1.9) / Math.sqrt(layers.length)
      const loose = ctx.params.loose

      for (const l of layers) {
        for (let guard = 0; guard < 128; guard++) {
          const u = timeOfPulse(l.n)
          if (u > L) {
            // Over the top: back to the bottom. The weight is zero here, so
            // nothing audible jumps.
            l.n = 0
            l.cycleStart += L
            continue
          }
          const at = l.cycleStart + u
          if (at > horizon) break
          const p = u / L
          const jitter = loose > 0 ? (r.next() - 0.5) * loose * 0.05 : 0
          const when = Math.max(at + jitter, ctx.audio.currentTime + 0.005)
          ping(l.midi, when, gain * weightAt(p), l.pan)
          l.n++
        }
      }
    })

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const L = ctx.params.cycle
      const padL = 48
      const padR = 14
      const top = 22
      const stairH = Math.max(90, h * 0.46)
      const now = ctx.audio.currentTime

      const lo = ctx.params.slowest
      const hi = lo * Math.pow(2, ctx.params.octaves)
      const y = (rate: number) =>
        top + (1 - Math.log2(clamp(rate, lo, hi) / lo) / ctx.params.octaves) * stairH

      // the bell, drawn as the width of the band
      g.fillStyle = 'rgba(255,255,255,0.04)'
      g.beginPath()
      for (let s = 0; s <= 80; s++) {
        const p = s / 80
        const yy = y(rateAt(p))
        const half = weightAt(p) * (w - padL - padR) * 0.5
        g.lineTo(padL + (w - padL - padR) / 2 - half, yy)
      }
      for (let s = 80; s >= 0; s--) {
        const p = s / 80
        const yy = y(rateAt(p))
        const half = weightAt(p) * (w - padL - padR) * 0.5
        g.lineTo(padL + (w - padL - padR) / 2 + half, yy)
      }
      g.fill()

      g.font = '9px ui-monospace, monospace'
      for (let o = 0; o <= ctx.params.octaves; o++) {
        const rate = lo * Math.pow(2, o)
        g.strokeStyle = 'rgba(255,255,255,0.06)'
        g.beginPath()
        g.moveTo(padL, y(rate))
        g.lineTo(w - padR, y(rate))
        g.stroke()
        g.fillStyle = 'rgba(255,255,255,0.24)'
        g.textAlign = 'right'
        g.fillText(`${rate.toFixed(1)}/s`, padL - 5, y(rate) + 3)
        g.textAlign = 'left'
      }

      const hue = (i: number) => `hsl(${(199 + i * 41) % 360} 88% 66%)`
      layers.forEach((l, i) => {
        const u = origin < 0 ? 0 : ((now - l.cycleStart) % L + L) % L
        const p = u / L
        const rate = rateAt(p)
        const wgt = weightAt(p)
        const cx = padL + (w - padL - padR) / 2
        g.fillStyle = hue(i)
        g.globalAlpha = 0.25 + 0.75 * wgt
        g.beginPath()
        g.arc(cx, y(rate), 3 + 7 * wgt, 0, Math.PI * 2)
        g.fill()
        g.globalAlpha = 1
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.font = '9px ui-monospace, monospace'
        g.fillText(`${rate.toFixed(1)}`, cx + 14 + 7 * wgt, y(rate) + 3)
      })

      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('every dot is climbing · the band is how loud it is there', padL, top - 6)

      // -- the pulses, as they will fall ----------------------------------------
      const rollTop = top + stairH + 26
      const rollH = h - rollTop - 34
      if (rollH > 24 && origin >= 0) {
        const span = 8
        const rx = (t: number) => padL + (1 - (now - t) / span) * (w - padL - padR)
        const lane = rollH / Math.max(1, layers.length)
        layers.forEach((l, i) => {
          const yy = rollTop + lane * (i + 0.5)
          g.strokeStyle = 'rgba(255,255,255,0.04)'
          g.beginPath()
          g.moveTo(padL, yy)
          g.lineTo(w - padR, yy)
          g.stroke()
          // walk this layer's schedule across the visible window
          let cs = l.cycleStart
          while (cs > now - span) cs -= L
          for (let c = 0; c < 4; c++) {
            for (let n = 0; n < 4000; n++) {
              const u = timeOfPulse(n)
              if (u > L) break
              const t = cs + c * L + u
              if (t < now - span) continue
              if (t > now + 1) break
              const x = rx(t)
              if (x < padL || x > w - padR) continue
              const wgt = weightAt(u / L)
              g.fillStyle = hue(i)
              g.globalAlpha = 0.15 + 0.85 * wgt
              g.fillRect(x - 0.5, yy - lane * 0.32, 1.4, lane * 0.64)
              g.globalAlpha = 1
            }
          }
        })
        g.strokeStyle = 'rgba(255,255,255,0.5)'
        g.beginPath()
        g.moveTo(rx(now), rollTop)
        g.lineTo(rx(now), rollTop + rollH)
        g.stroke()
      }

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.72)'
      g.fillText(
        `${layers.length} layers · each doubles every ${(L / ctx.params.octaves).toFixed(1)} s` +
          `   ·   the whole thing repeats every ${L} s`,
        padL,
        h - 20,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = ctx.params.seam > 0.5 ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.32)'
      g.fillText(
        ctx.params.seam > 0.02
          ? `seam ${ctx.params.seam.toFixed(2)} — the bell is flattening, and you can hear each layer snap back`
          : 'nothing audible ever goes down · turn Seam up to break it',
        padL,
        h - 6,
      )
    })

    // A read-only snapshot for the harness: the model's own idea of where each
    // layer is, so measured pulse rates can be checked against it.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__staircase = () => ({
      origin,
      now: ctx.audio.currentTime,
      cycle: ctx.params.cycle,
      octaves: ctx.params.octaves,
      slowest: ctx.params.slowest,
      seam: ctx.params.seam,
      layers: layers.map((l) => ({
        midi: l.midi,
        cycleStart: l.cycleStart,
        p: origin < 0 ? 0 : (((ctx.audio.currentTime - l.cycleStart) % ctx.params.cycle) + ctx.params.cycle) % ctx.params.cycle / ctx.params.cycle,
      })),
    })
    ctx.cleanup(() => delete wnd.__staircase)

    ctx.status('it never stops speeding up and it never gets anywhere · Seam breaks the illusion')
  },
})
