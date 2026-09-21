import { degree, disposeAt, mtof, reverb, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  compose,
  flatCost,
  freeMask,
  noise,
  parse,
  realise,
  walk,
  type Options,
  type Token,
} from './parse'

/**
 * The shortest way to write a tune down.
 *
 * `rhyme` was handed a list of rhymes — "bar 5 is bar 2, up a third" — and
 * solved for the notes. It was told the structure. This asks the question the
 * other way round: given the notes, *find* the structure, by looking for the
 * description that takes the fewest bits.
 *
 * As a coding problem that is Lempel–Ziv with one change that makes it music: a
 * back-reference may also be transposed, inverted or reversed, which is a
 * composer's vocabulary rather than a compressor's. And because the parse runs
 * left to right, each token's position is implicit — so the cheapest
 * description is a shortest path over note positions, and the optimum is a
 * dynamic program rather than a search.
 *
 * What you hear is the difference between the notes somebody had to *choose*
 * and the notes that follow from them. `Play` at `skeleton` is the free notes
 * alone: hand somebody those and the rhyme list and they have the whole tune.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-21-shorthand.md`.
 */

const COLOURS = {
  free: '#fbbf24',
  plain: '#7dd3fc',
  invert: '#f472b6',
  retro: '#34d399',
  both: '#a78bfa',
}

export default defineSketch({
  title: 'Shorthand',
  description: 'Find a tune\'s motifs by asking what the shortest way to write it down is.',
  tags: ['composition', 'tool', 'theory', 'process'],
  status: 'promising',
  bpm: 104,
  division: 2,

  params: {
    notes: { type: 'number', value: 64, min: 24, max: 96, step: 4, label: 'Notes' },
    /** How often the tune's author reached for a rhyme rather than a new note. */
    structure: { type: 'number', value: 0.6, min: 0, max: 0.9, step: 0.01, label: 'Structure' },
    /** `walk` and `noise` are the controls: nobody composed them. */
    source: { type: 'select', value: 'composed', options: ['composed', 'walk', 'noise'], label: 'Tune' },
    /** How far a note may sit from what the transform predicts and still count. */
    tol: { type: 'number', value: 0, min: 0, max: 3, step: 1, label: 'Tolerance', unit: '°' },
    minLen: { type: 'number', value: 3, min: 2, max: 8, step: 1, label: 'Shortest rhyme' },
    maxLen: { type: 'number', value: 16, min: 4, max: 24, step: 1, label: 'Longest rhyme' },
    invert: { type: 'toggle', value: true, label: 'Allow inversion' },
    retro: { type: 'toggle', value: true, label: 'Allow retrograde' },
    /** The compression claim, made audible. */
    play: { type: 'select', value: 'all', options: ['all', 'skeleton', 'derived'], label: 'Play' },
    root: { type: 'number', value: 55, min: 36, max: 72, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Space' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 11, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
\`rhyme\` was told the structure and solved for the notes. This is the other
direction: given the notes, find the structure, by looking for the description
that takes the fewest bits. That is Lempel–Ziv with a composer's vocabulary —
a back-reference may be transposed, inverted or reversed — and because the parse
runs left to right the optimum is a **dynamic program, not a search**.

**Two gates before any of it counts.** A description that does not rebuild the
tune is not a description: at tolerance 0, \`realise(parse(d))\` equals \`d\`
exactly in **180 of 180** tunes across composed, walk and noise. And a
"shortest" description is only shortest if nothing shorter exists: against an
exhaustive search sharing none of its bookkeeping, **95 of 95 agree with a gap
of exactly 0.0 bits**.

**What compresses.** Bits per note against the 5.00 a flat list costs:

| tune | bits/note | ratio | notes you must write |
| --- | --- | --- | --- |
| composed, structure 0.7 | 3.17 | 0.634 | 21.3 of 80 |
| composed, structure 0.3 | 3.39 | 0.679 | 27.0 of 80 |
| random walk | 4.57 | 0.913 | 43.0 of 80 |
| uniform noise | **4.99** | **0.998** | 77.6 of 80 |

Noise is incompressible to within 0.2%, which is the control that says the rest
is not an artefact of the code.

**A transform is worth what the tune contains, and nothing otherwise.** The
saving from allowing inversion and retrograde:

| tune built with | saving |
| --- | --- |
| transposition only | **0.9%** |
| inversion too | 9.3% |
| all three | 14.5% |
| nobody — uniform noise | **0.2%** |

and the discrimination is specific: on tunes containing inversions, allowing
inversion gives 3.183 bits/note where allowing retrograde instead gives 3.450.
It finds the transform that is there and does not invent the one that is not.

**The parser beats the composer, 199 times in 200.** Given a tune built *from* a
description, it finds a cheaper one — 15.7–17.7% cheaper. So "did it recover the
structure I planted" is the wrong question, and recovery pools to only 33%. Ask
it by length and it makes sense: planted rhymes of 3 or 4 notes are recovered
**0%** of the time, and ones of 10 or more **43–69%**. A short rhyme is not a
fact about a tune, it is one of several equally cheap readings.

**And a tolerance is not a bound.** \`Tolerance\` 1 cuts the description by 33%
(4.57 → 3.08 bits/note) for a mean error of 0.61 degrees — but the worst error
is **4**, and 454 notes in 4,800 end up further off than the tolerance allowed.
Approximations chain: a span fitted loosely becomes the source for the next one,
and the reference chains run up to **5 deep**. "Roughly that phrase, up a third"
is a promise about one step, not about the result.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.6 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the tune and its description -----------------------------------------

    let degrees: number[] = []
    let toks: Token[] = []
    let free: boolean[] = []
    let cost = 0
    let flat = 0
    /** Which token covers each note, so the drawing can say why it is there. */
    let owner: Array<Token | null> = []

    const build = () => {
      const n = Math.round(ctx.params.notes)
      const o: Options = {
        minLen: Math.round(ctx.params.minLen),
        maxLen: Math.max(Math.round(ctx.params.minLen), Math.round(ctx.params.maxLen)),
        tol: Math.round(ctx.params.tol),
        invert: ctx.params.invert,
        retro: ctx.params.retro,
      }
      const seed = Math.round(ctx.params.seed)
      degrees =
        ctx.params.source === 'walk'
          ? walk(n, seed)
          : ctx.params.source === 'noise'
            ? noise(n, seed)
            : compose(n, seed, ctx.params.structure, o).degrees
      const p = parse(degrees, o)
      toks = p.toks
      cost = p.cost
      flat = flatCost(n)
      free = freeMask(toks, n)
      // the description has to rebuild the tune, so play what it rebuilds —
      // otherwise `skeleton` would be a claim the sketch never actually tests
      degrees = realise(toks, n)
      owner = new Array(n).fill(null)
      for (const t of toks) {
        if (t.kind === 'free') owner[t.at] = t
        else for (let i = 0; i < t.len; i++) owner[t.at + i] = t
      }
    }
    build()
    for (const k of ['notes', 'structure', 'source', 'tol', 'minLen', 'maxLen', 'invert', 'retro', 'seed'] as const) {
      ctx.onParam(k, build)
    }

    // -- the sound -------------------------------------------------------------

    const voice = (pitch: number, at: number, gain: number, bright: number, dur: number) => {
      const t = Math.max(at, ctx.audio.currentTime + 0.004)
      const f = mtof(pitch)

      const lp = ctx.audio.createBiquadFilter()
      lp.type = 'lowpass'
      lp.Q.value = 0.9
      lp.frequency.setValueAtTime(f * (2 + bright * 6), t)
      lp.frequency.exponentialRampToValueAtTime(Math.max(160, f * 1.2), t + dur)
      lp.connect(bus)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, t)
      // 9 ms, not 2 — a note that is *derived* should not announce itself, and
      // a hard edge on every note would read as a click track
      amp.gain.linearRampToValueAtTime(gain, t + 0.009)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.01), t + dur)
      amp.connect(lp)

      const o1 = ctx.audio.createOscillator()
      o1.type = 'triangle'
      o1.frequency.value = f
      o1.connect(amp)
      o1.start(t)
      disposeAt(o1, t + dur + 0.05)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'sawtooth'
      o2.frequency.value = f
      o2.detune.value = 5
      const a2 = ctx.audio.createGain()
      a2.gain.value = 0.25 + bright * 0.4
      o2.connect(a2).connect(amp)
      o2.start(t)
      disposeAt(o2, t + dur + 0.05, [a2, amp, lp])
    }

    let base = -1
    let at = 0
    let played = 0
    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const n = degrees.length
      if (!n) return
      at = (e.step - base) % n
      const isFree = free[at]
      const mode = ctx.params.play
      if (mode === 'skeleton' && !isFree) return
      if (mode === 'derived' && isFree) return

      const scale = ctx.params.scale as ScaleName
      const root = Math.round(ctx.params.root)
      const pitch = degree(root, scale, degrees[at])
      // A free note is one somebody had to choose; a derived one follows. The
      // difference is the whole point, so it is louder and brighter rather than
      // merely a different colour on the screen.
      const lvl = 0.39 + ctx.params.level * 0.44
      const gain = isFree ? lvl : lvl * 0.52
      voice(pitch, e.time, gain, isFree ? 0.85 : 0.3, Math.min(1.4, e.dur * 2.6))
      played++
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
      const n = degrees.length
      if (!n) return

      const freeCount = free.filter(Boolean).length
      const rhymes = toks.filter((t) => t.kind === 'rhyme').length
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `${cost.toFixed(0)} bits for ${n} notes — ${(cost / n).toFixed(2)}/note against ${(flat / n).toFixed(2)} flat` +
          `   (${((cost / flat) * 100).toFixed(0)}%)   ${freeCount} written out, ${n - freeCount} follow` +
          `   ${rhymes} rhymes`,
        pad,
        pad + 10,
      )

      const top = pad + head
      const avail = h - top - pad
      const rollH = Math.max(80, avail * 0.58)
      const arcTop = top + rollH + 6
      const arcH = Math.max(40, avail - rollH - 6)
      const x = (i: number) => pad + ((i + 0.5) / n) * (w - pad * 2)

      // -- the tune, with what had to be chosen picked out ----------------------
      let lo = Infinity
      let hi = -Infinity
      for (const d of degrees) {
        if (d < lo) lo = d
        if (d > hi) hi = d
      }
      const span = Math.max(1, hi - lo)
      const y = (d: number) => top + rollH - 8 - ((d - lo) / span) * (rollH - 22)
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, top, w - pad * 2, rollH)

      const cw = Math.max(2, (w - pad * 2) / n - 1.5)
      for (let i = 0; i < n; i++) {
        const t = owner[i]
        const col =
          free[i]
            ? COLOURS.free
            : t && t.kind === 'rhyme'
              ? t.t.a === -1 && t.t.retro
                ? COLOURS.both
                : t.t.a === -1
                  ? COLOURS.invert
                  : t.t.retro
                    ? COLOURS.retro
                    : COLOURS.plain
              : COLOURS.plain
        g.fillStyle = col
        g.globalAlpha = free[i] ? 0.95 : 0.55
        g.fillRect(x(i) - cw / 2, y(degrees[i]) - 2.5, cw, 5)
        g.globalAlpha = 1
      }
      if (ctx.clock.running) {
        g.fillStyle = 'rgba(255,255,255,0.5)'
        g.fillRect(x(at) - 0.5, top, 1, rollH)
      }

      // -- where each phrase came from ------------------------------------------
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, arcTop, w - pad * 2, arcH)
      for (const t of toks) {
        if (t.kind !== 'rhyme') continue
        const a = x(t.from + t.len / 2)
        const b = x(t.at + t.len / 2)
        const col =
          t.t.a === -1 && t.t.retro
            ? COLOURS.both
            : t.t.a === -1
              ? COLOURS.invert
              : t.t.retro
                ? COLOURS.retro
                : COLOURS.plain
        g.strokeStyle = col
        g.globalAlpha = 0.5
        g.lineWidth = Math.max(1, Math.min(3, t.len / 5))
        const r = Math.min(arcH - 8, Math.abs(b - a) / 2)
        g.beginPath()
        g.moveTo(a, arcTop + arcH - 4)
        g.quadraticCurveTo((a + b) / 2, arcTop + arcH - 4 - r * 2, b, arcTop + arcH - 4)
        g.stroke()
        g.globalAlpha = 1
      }
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '9px ui-monospace, monospace'
      const legend =
        'gold = written out   blue = transposed   pink = inverted   green = backwards   purple = both'
      g.fillText(legend, pad + 4, arcTop + arcH - 3)
      g.fillText(
        `${ctx.params.source}${ctx.params.source === 'composed' ? ` ${ctx.params.structure.toFixed(2)}` : ''}` +
          `   tol ${Math.round(ctx.params.tol)}   rhymes ${Math.round(ctx.params.minLen)}–${Math.round(ctx.params.maxLen)}` +
          `   playing ${ctx.params.play}`,
        pad + 4,
        arcTop + 11,
      )
    })

    // -- for the harness --------------------------------------------------------
    const api = {
      set: (key: string, v: unknown) => ctx.set(key as never, v as never),
      degrees: () => degrees,
      toks: () => toks,
      free: () => free,
      cost: () => cost,
      flat: () => flat,
      played: () => played,
      pitches: () => {
        const scale = ctx.params.scale as ScaleName
        const root = Math.round(ctx.params.root)
        return degrees.map((d) => degree(root, scale, d))
      },
      tap: () => bus,
    }
    ;(window as unknown as Record<string, unknown>).__shorthand = () => api
    ctx.cleanup(() => delete (window as unknown as Record<string, unknown>).__shorthand)
  },
})
