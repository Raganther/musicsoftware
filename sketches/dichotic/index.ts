import { degree, disposeAt, mtof, reverb, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  byHeight,
  compose,
  crossedThrough,
  crossings,
  ears,
  jaggedness,
  matches,
  minMotion,
  scales,
  scatter,
  type Piece,
  type Scatter,
} from './stream'

/**
 * Two melodies, cut up between the ears, and the ones you actually hear.
 *
 * Diana Deutsch's scale illusion, 1975: send an ascending scale to one ear and
 * a descending one to the other, alternating which ear gets which note, and
 * nobody hears what was sent. Each ear physically receives a sequence leaping
 * about by four degrees a step; what people report is a smooth line high on one
 * side and a smooth line low on the other. Hearing groups by *pitch proximity*
 * before it groups by ear.
 *
 * Every other illusion in this repo is a fact about the signal — `tartini`'s
 * difference tones sit in the wire at −164 dB and come up 120 dB through a
 * nonlinearity, which is measurable. This one is central, so there is nothing
 * in the wire to point at. What *is* exactly computable is the combinatorics:
 * regrouping two notes into two streams is a two-state assignment, so "what a
 * listener grouping by proximity would hear" has an optimum and can be put
 * beside what was composed and what each ear received.
 *
 * Which makes it a composition tool with a number on it. `Listen` is the
 * reveal: `as sent` is the truth, `as grouped` is the percept made physical,
 * and one ear alone is neither.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-22-dichotic.md`.
 */

const COLOURS = { left: '#7dd3fc', right: '#fbbf24', hi: '#f472b6', lo: '#34d399' }

export default defineSketch({
  title: 'Dichotic',
  description: 'Two lines split between the ears, so neither ear receives the music and both of you hear it.',
  tags: ['illusion', 'psychoacoustics', 'composition', 'listening'],
  status: 'promising',
  bpm: 96,
  division: 2,

  params: {
    notes: { type: 'number', value: 48, min: 16, max: 96, step: 4, label: 'Notes' },
    /** `scales` is Deutsch's own pair: one up, one down, meeting in the middle. */
    source: { type: 'select', value: 'composed', options: ['composed', 'scales'], label: 'Lines' },
    /** Crossings per step. 0 means the lines never swap which is higher. */
    cross: { type: 'number', value: 0.05, min: 0, max: 0.5, step: 0.01, label: 'Crossing rate' },
    /** `alternate` is the illusion; `none` is the control with no scattering. */
    scatterMode: { type: 'select', value: 'alternate', options: ['alternate', 'random', 'none'], label: 'Scatter' },
    /** The reveal. `as grouped` plays the percept as if it were the signal. */
    listen: {
      type: 'select',
      value: 'as sent',
      options: ['as sent', 'as grouped', 'left only', 'right only', 'mono'],
      label: 'Listen',
    },
    root: { type: 'number', value: 57, min: 40, max: 72, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.18, min: 0, max: 0.6, step: 0.01, label: 'Space' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Deutsch's scale illusion, 1975. Send one line to the left ear and another to the
right, alternating which line goes where, and nobody hears what was sent: each
ear receives a sequence leaping about, and what listeners report is a smooth
high line on one side and a smooth low line on the other. Hearing groups by
**pitch proximity before it groups by ear**.

The illusion is central, so unlike \`tartini\` there is nothing in the wire to
point at. The combinatorics can be measured exactly instead — regrouping two
notes into two streams is a two-state assignment with an exact optimum.

**The gate.** If the two lines never swap which is higher, any proximity rule
must recover them exactly whatever the scattering did. Over 60 crossing-free
pieces × 3 scatterings, both the by-height rule and the minimum-motion one
recover the composed lines at **1.0000**, every time.

**The size of it.** Mean step in scale degrees, across 60 pieces:

| scatter | per ear | per stream | ear ÷ stream |
| --- | --- | --- | --- |
| none | 0.400 | 0.400 | 1.00× |
| random | 2.955 | 0.400 | 7.38× |
| alternate | **5.382** | **0.400** | **13.45×** |

Alternating makes each ear **13.45× more jagged while leaving the music
untouched** — the streams' figure is identical to the composed lines' own.
Deutsch's actual scale pair gives 3.952 per ear against 1.000 per stream.

**Where the two rules disagree is a compositional handle.** By-height grouping
can never hear a crossing — it bounces at every one, 0.0% crossed at every rate
tested. Minimum-motion grouping *does* cross, and how often depends on how fast
the lines converge:

| crossings per step | 0.05 | 0.10 | 0.20 | 0.40 |
| --- | --- | --- | --- | --- |
| min-motion passed through | **39.6%** | 32.4% | 16.2% | **7.7%** |

Lines that converge slowly linger near each other, so passing through costs
almost nothing; lines that sweep through are far apart either side, so a stream
that crossed would have to leap and bouncing is cheaper. **How fast your lines
approach decides whether a listener hears them cross or bounce**, which is a
thing to compose with and not a fact about the notes.

I predicted minimum-motion would bounce too, and wrote it down first. It is
wrong at slow crossings and right at fast ones.

**And the classic pair is not recovered, which is the point.** Deutsch's scales
meet in the middle, so they *do* cross, and the percept is the bouncing contour
(8 7 6 5 4 5 6 7) rather than either scale. Recovery against the composed lines
is 0.5625 and the illusion is total.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the piece -------------------------------------------------------------

    let piece: Piece = { lines: [[], []], side: [] }
    let sent: [number[], number[]] = [[], []]
    let heard: [number[], number[]] = [[], []]
    let motion: [number[], number[]] = [[], []]
    let stats = { earJag: 0, streamJag: 0, lineJag: 0, cross: 0, recovered: 0, through: 0 }

    const build = () => {
      const n = Math.round(ctx.params.notes)
      const seed = Math.round(ctx.params.seed)
      const lines =
        ctx.params.source === 'scales' ? scales(n) : compose(n, seed, ctx.params.cross)
      piece = { lines, side: scatter(n, ctx.params.scatterMode as Scatter, seed) }
      sent = ears(piece)
      heard = byHeight(piece)
      motion = minMotion(piece).streams
      const ct = crossedThrough(motion, lines)
      stats = {
        earJag: (jaggedness(sent[0]) + jaggedness(sent[1])) / 2,
        streamJag: (jaggedness(heard[0]) + jaggedness(heard[1])) / 2,
        lineJag: (jaggedness(lines[0]) + jaggedness(lines[1])) / 2,
        cross: crossings(lines),
        recovered: matches(heard, lines),
        through: ct.total ? ct.crossed / ct.total : 0,
      }
    }
    build()
    for (const k of ['notes', 'source', 'cross', 'scatterMode', 'seed'] as const) ctx.onParam(k, build)

    // -- the sound -------------------------------------------------------------

    const voice = (deg: number, at: number, pan: number, gain: number, dur: number) => {
      const t = Math.max(at, ctx.audio.currentTime + 0.004)
      const pitch = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg)
      const f = mtof(pitch)

      const pn = ctx.audio.createStereoPanner()
      // Hard-panned on purpose: the illusion is dichotic, and anything less
      // than fully separated gives both ears both notes, which is the control
      // rather than the piece. Headphones are the instrument here.
      pn.pan.value = pan
      pn.connect(bus)

      const lp = ctx.audio.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = f * 5
      lp.connect(pn)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, t)
      // 12 ms: Deutsch's tones are steady, and a percussive edge would give
      // onset synchrony a say in the grouping that the experiment does not want
      amp.gain.linearRampToValueAtTime(gain, t + 0.012)
      amp.gain.setValueAtTime(gain, t + dur * 0.62)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.01), t + dur)
      amp.connect(lp)

      const o = ctx.audio.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      o.connect(amp)
      o.start(t)
      disposeAt(o, t + dur + 0.05, [amp, lp, pn])
    }

    let base = -1
    let at = 0
    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const n = piece.side.length
      if (!n) return
      at = (e.step - base) % n
      const mode = ctx.params.listen
      const dur = Math.min(0.9, e.dur * 1.1)
      const g = 0.45 + ctx.params.level * 0.45

      if (mode === 'as grouped') {
        // the percept made physical: high stream left, low stream right
        voice(heard[0][at], e.time, -1, g, dur)
        voice(heard[1][at], e.time, 1, g, dur)
      } else if (mode === 'left only') {
        voice(sent[0][at], e.time, 0, g, dur)
      } else if (mode === 'right only') {
        voice(sent[1][at], e.time, 0, g, dur)
      } else if (mode === 'mono') {
        voice(sent[0][at], e.time, 0, g * 0.8, dur)
        voice(sent[1][at], e.time, 0, g * 0.8, dur)
      } else {
        voice(sent[0][at], e.time, -1, g, dur)
        voice(sent[1][at], e.time, 1, g, dur)
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          at = 0
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const head = 15
      const n = piece.side.length
      if (!n) return

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `per ear ${stats.earJag.toFixed(2)}   per stream ${stats.streamJag.toFixed(2)}` +
          `   ${(stats.earJag / Math.max(1e-6, stats.streamJag)).toFixed(2)}× more jagged in the ear` +
          `   ${stats.cross} crossings   recovered ${(stats.recovered * 100).toFixed(0)}%` +
          (stats.cross ? `   min-motion passed through ${(stats.through * 100).toFixed(0)}%` : ''),
        pad,
        pad + 10,
      )

      const top = pad + head
      const avail = h - top - pad
      const paneH = (avail - 8) / 2
      const x = (i: number) => pad + ((i + 0.5) / n) * (w - pad * 2)

      let lo = Infinity
      let hi = -Infinity
      for (const s of [sent[0], sent[1]]) for (const d of s) {
        if (d < lo) lo = d
        if (d > hi) hi = d
      }
      const span = Math.max(1, hi - lo)

      const drawPane = (
        top0: number,
        a: number[],
        b: number[],
        ca: string,
        cb: string,
        label: string,
      ) => {
        g.fillStyle = 'rgba(255,255,255,0.03)'
        g.fillRect(pad, top0, w - pad * 2, paneH)
        const y = (d: number) => top0 + paneH - 14 - ((d - lo) / span) * (paneH - 26)
        for (const [seq, col] of [
          [a, ca],
          [b, cb],
        ] as Array<[number[], string]>) {
          g.strokeStyle = col
          g.globalAlpha = 0.85
          g.lineWidth = 1.4
          g.beginPath()
          for (let i = 0; i < n; i++) {
            if (i === 0) g.moveTo(x(i), y(seq[i]))
            else g.lineTo(x(i), y(seq[i]))
          }
          g.stroke()
          g.globalAlpha = 1
        }
        if (ctx.clock.running) {
          g.fillStyle = 'rgba(255,255,255,0.4)'
          g.fillRect(x(at) - 0.5, top0, 1, paneH)
        }
        g.fillStyle = 'rgba(255,255,255,0.4)'
        g.font = '9px ui-monospace, monospace'
        g.fillText(label, pad + 5, top0 + 11)
        g.font = '11px ui-monospace, monospace'
      }

      drawPane(
        top,
        sent[0],
        sent[1],
        COLOURS.left,
        COLOURS.right,
        `what each ear receives — blue left, gold right (mean step ${stats.earJag.toFixed(2)})`,
      )
      drawPane(
        top + paneH + 8,
        heard[0],
        heard[1],
        COLOURS.hi,
        COLOURS.lo,
        `what proximity grouping gives — pink high, green low (mean step ${stats.streamJag.toFixed(2)})`,
      )
    })

    // -- for the harness --------------------------------------------------------
    const api = {
      set: (key: string, v: unknown) => ctx.set(key as never, v as never),
      piece: () => piece,
      sent: () => sent,
      heard: () => heard,
      motion: () => motion,
      stats: () => stats,
      pitches: (seq: number[]) =>
        seq.map((d) => degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, d)),
      tap: () => bus,
    }
    ;(window as unknown as Record<string, unknown>).__dichotic = () => api
    ctx.cleanup(() => delete (window as unknown as Record<string, unknown>).__dichotic)
  },
})
