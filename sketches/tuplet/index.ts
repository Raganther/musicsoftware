import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { bestNotation, levels, type Notation } from './notate'

/**
 * The gap between the rhythm you meant and the rhythm you can write.
 *
 * `elastic` solves a rhythm from stated ratios and hands back *real numbers*.
 * Notation cannot express a real number. It can express a dyadic fraction of a
 * bar — halves, quarters, eighths — scaled by a tuplet, n notes in the time of
 * m, and tuplets nest. So everything writable has a denominator that is a
 * product of the tuplet numbers you allow times a power of two, which means
 * **a duration is notatable exactly when its denominator is N-smooth**.
 *
 * Both rhythms play at once: the one you meant in one hand, the one you wrote
 * in the other. The flam between them *is* the notation error, and it closes as
 * you spend more tuplets. At eighth-notes with no tuplets it is 109 ms, which
 * is not a subtlety — it is a different rhythm.
 *
 * The other half is `elastic`'s, and it is why notating is not rounding: the
 * durations have to add up. Round each note to the nearest writable value
 * independently and the bar stops closing in 40% of cases, so somebody has to
 * absorb the remainder.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-16-tuplet.md`.
 */

const MAX_NOTES = 9
const SOURCES = ['simple ratios', 'uniform reals', 'powers of phi', '11 and 13']

export default defineSketch({
  title: 'Tuplet',
  description: 'The rhythm you meant against the rhythm you can write. The flam between them is the notation error.',
  tags: ['rhythm', 'notation', 'composition'],
  status: 'promising',
  bpm: 100,
  division: 4,

  params: {
    notes: { type: 'number', value: 5, min: 3, max: MAX_NOTES, step: 1, label: 'Notes in the bar' },
    /** Where the intended durations come from. Only the first is ever writable. */
    source: { type: 'select', value: 'uniform reals', options: SOURCES, label: 'Durations from' },
    /** The largest tuplet you are willing to write. 1 means none at all. */
    tuplet: { type: 'number', value: 7, min: 1, max: 13, step: 2, label: 'Largest tuplet' },
    /** How deep you will nest them. */
    depth: { type: 'number', value: 1, min: 0, max: 3, step: 1, label: 'Nesting depth' },
    /** Shortest plain note value, as 1/2^n of the bar. */
    shortest: { type: 'number', value: 4, min: 2, max: 6, step: 1, label: 'Shortest note 1/2^n' },
    /** Play the rhythm you meant underneath, so the error is audible as a flam. */
    meant: { type: 'toggle', value: true, label: 'Also play what was meant' },
    root: { type: 'number', value: 55, min: 36, max: 72, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 0.5, min: 0.1, max: 1.4, step: 0.01, label: 'Decay' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Notation cannot express a real number. It expresses a dyadic fraction of a bar
scaled by a tuplet, and tuplets nest, so everything writable has a denominator
that is a power of two times a product of the tuplet numbers you allow — which
means **a duration is writable exactly when its denominator is N-smooth**.
Checked against the definition of smoothness for N = 3, 5, 7 and 11: the
reachable denominators and the N-smooth ones are the **same set**, every time.

The nesting depth is then the shortest factorisation of the odd part. 9 needs
two levels and 49 needs two; 27 needs three; 11 and 13 and 33 cannot be written
at all with tuplets up to 7.

**One tuplet is worth more than three halvings of the note value.** Worst
single-note error over 300 random rhythms of five notes:

| shortest note | no tuplets | ≤7, one deep | ≤7, two deep | ≤7, three deep |
| --- | --- | --- | --- | --- |
| 1/8 | 5.596% | 0.789% | 0.113% | 0.016% |
| 1/16 | 2.919% | 0.398% | 0.058% | 0.008% |
| 1/32 | 1.426% | 0.197% | 0.028% | 0.004% |
| 1/64 | 0.725% | 0.100% | 0.014% | 0.002% |

Halving the note value halves the error; adding one tuplet level divides it by
seven. **A triplet at eighth-notes (0.789%) beats plain 64th-notes (0.725%)
about evenly, and two nested tuplets at eighth-notes beat 64th-notes by six
times.**

In milliseconds at a two-second bar, which is what the ear reads: no tuplets at
1/8 is **109 ms** out — a different rhythm, not a nuance. One tuplet level is
16 ms, two is 2.3 ms, and around 20–30 ms is where two onsets stop sounding
simultaneous.

**Notating is not rounding, because the bar has to close.** Round each note
independently to the nearest writable value and the bar came out wrong in
**161 of 400** random rhythms. Handing the remainder to whichever note was
rounded furthest fixes it in 400 of 400 — which is what a person does.

**Smoothness costs about a factor of four.** Allowed *any* denominator up to
192 the best approximation averages 0.006%; allowed only the smooth ones, 0.022%
— and the penalty grows with the budget (1.17× at 12, 3.87× at 192), because
large smooth numbers are rare.

**What separates rhythms is exactness, not accuracy.** Durations drawn from
simple ratios are written *exactly* 105 times in 400; from uniform reals, 0
times; from powers of φ, 0. But when they are not exact, they are all about
equally inexact — 0.043%, 0.056%, 0.052%. I expected φ to be the hardest to
write, since it is the hardest number to approximate by fractions, and over
eight values of a two-note ratio **that is not what happens**: φ comes out at
0.002% and e/2 at 0.027%. The classical result is about denominators up to a
bound, and a tuplet budget does not give you those — it gives you a sparse
scatter of large smooth numbers, where which irrational you picked stops
mattering. Whether it is rational at all is the only thing that does.

**Some bars cannot be written at all.** Five notes do not fit on a grid of
quarters, whatever you round them to — there are four slots. Asked for that the
sketch says so, rather than quietly reaching outside the budget.

**And you can hear all of it.** Onsets read off a recording, against the model:

| budget | denominator | model says | heard | heard vs model |
| --- | --- | --- | --- | --- |
| no tuplets, 1/8 | 8 | 189.3 ms | 189.1 ms | 1.13 ms |
| no tuplets, 1/16 | 16 | 110.7 ms | 110.6 ms | 1.25 ms |
| ≤3 one deep, 1/8 | 24 | 42.2 ms | 43.3 ms | 1.13 ms |
| ≤7 one deep, 1/16 | 112 | 6.4 ms | 6.5 ms | 1.06 ms |
| ≤7 two deep, 1/16 | 784 | 1.1 ms | 0.9 ms | 1.18 ms |

The written rhythm tracks its own notation to **1.25 ms at worst** over a 200×
range of notation error, and the fold is unambiguous — the next-best alignment
of the same bar is 299 to 449 ms out. The detector is checked first on three
notes on a quarter grid, where every onset must land on an exact quarter: worst
**1.60 ms**.

With both voices playing, the number of distinct onsets the ear gets per bar
falls from **7.9 to 6.6** as the gap closes from 102 ms to 1.1 ms — the written
and meant notes merging into one. Directional rather than exact: at a 30 ms
refractory the detector cannot fully resolve the last of it.

Levels: 0.499 pre-limiter at the defaults, 0.671 at the loudest setting.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 1.8 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the rhythm you meant --------------------------------------------------

    /** Intended durations as fractions of the bar, and the pitches on them. */
    let meant: number[] = []
    let pitches: number[] = []
    let written: Notation = { parts: [], den: 1, depth: 0, durs: [], worst: 0, total: 0, ok: true }

    const PHI = (1 + Math.sqrt(5)) / 2
    const POOL = [1, 1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4, 3 / 2, 2, 4 / 3]
    const ELEVEN = [11 / 8, 13 / 8, 8 / 11, 8 / 13]

    const compose = () => {
      const r = rng(Math.round(ctx.params.seed))
      const n = Math.round(ctx.params.notes)
      const src = ctx.params.source
      const w: number[] = [1]
      for (let i = 1; i < n; i++) {
        if (src === 'simple ratios') w.push(w[i - 1] * POOL[r.int(0, POOL.length - 1)])
        else if (src === 'powers of phi') w.push(w[i - 1] * (r.next() < 0.5 ? PHI : 1 / PHI))
        else if (src === '11 and 13') w.push(w[i - 1] * ELEVEN[r.int(0, 3)])
        else w.push(0.3 + r.next())
      }
      const s = w.reduce((a, b) => a + b, 0)
      meant = w.map((v) => v / s)

      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      pitches = []
      let deg = 3
      for (let i = 0; i < n; i++) {
        deg = clamp(deg + r.int(-3, 3), -3, 10)
        pitches.push(degree(root, scale, deg))
      }
      renotate()
    }

    const renotate = () => {
      written = bestNotation(
        meant,
        Math.round(ctx.params.tuplet),
        Math.round(ctx.params.depth),
        2 ** Math.round(ctx.params.shortest),
      )
    }

    compose()
    for (const k of ['notes', 'source', 'seed', 'root', 'scale'] as const) ctx.onParam(k, compose)
    for (const k of ['tuplet', 'depth', 'shortest'] as const) ctx.onParam(k, renotate)

    // -- playing both at once --------------------------------------------------

    const pluck = (midi: number, time: number, gain: number, pan: number, bright: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const f = mtof(midi)
      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)
      const dec = ctx.params.decay

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // 6 ms, not 2 — a fast ramp on a sine is a broadband click, and a click on
      // both voices is exactly the flam this sketch exists to make audible
      amp.gain.linearRampToValueAtTime(gain, at + 0.006)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.015), at + dec)
      amp.connect(pn)

      const o1 = ctx.audio.createOscillator()
      o1.type = 'triangle'
      o1.frequency.value = f
      o1.connect(amp)
      o1.start(at)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = f * (bright > 0 ? 3.01 : 2.0)
      const a2 = ctx.audio.createGain()
      a2.gain.setValueAtTime(0, at)
      a2.gain.linearRampToValueAtTime(gain * (0.16 + bright * 0.3), at + 0.005)
      a2.gain.exponentialRampToValueAtTime(1e-4, at + dec * 0.4)
      o2.connect(a2).connect(pn)
      o2.start(at)

      disposeAt(o1, at + dec + 0.06, [amp])
      disposeAt(o2, at + dec + 0.06, [a2, pn])
    }

    /** Bar start times already scheduled, so a bar is laid out exactly once. */
    let nextBar = -1
    /** For the drawing: when the current bar started and how long it is. */
    let barAt = 0
    let barLen = 2

    ctx.clock.onStep((e) => {
      const beats = ctx.clock.beatsPerBar
      const len = ctx.clock.secondsPerBeat * beats
      if (nextBar < 0) nextBar = e.time + 0.05
      // The clock is a lookahead pump; the bar is laid out from its own start
      // time, not from the step grid, because the whole subject is durations
      // that do not land on the grid.
      for (let guard = 0; guard < 4; guard++) {
        if (nextBar >= e.time + e.dur) break
        const start = nextBar
        barAt = start
        barLen = len
        // Nine notes at a long decay puts ten of these on top of each other and
        // read 1.070 pre-limiter, which is clipping. Scale by how many are
        // actually overlapping — decay times the note rate, doubled when the
        // second voice is on — normalised so the defaults are unchanged.
        const n = Math.round(ctx.params.notes)
        const stacked = ((ctx.params.meant ? 2 : 1) * ctx.params.decay * n) / len
        const lvl = (0.5 + ctx.params.level * 0.55) * Math.sqrt(2.1 / Math.max(2.1, stacked))
        let t = 0
        for (let i = 0; i < written.durs.length; i++) {
          pluck(pitches[i], start + t * len, lvl, -0.38, 1)
          t += written.durs[i]
        }
        if (ctx.params.meant) {
          let u = 0
          for (let i = 0; i < meant.length; i++) {
            pluck(pitches[i] - 12, start + u * len, lvl * 0.82, 0.38, 0)
            u += meant[i]
          }
        }
        nextBar = start + len
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) nextBar = -1
      }),
    )

    // -- drawing ---------------------------------------------------------------

    /** Error against budget, for the staircase. Recomputed when the rhythm does. */
    let grid: { depth: number; err: number[] }[] = []
    let gridKey = ''

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const head = 15
      const key = `${ctx.params.seed}|${ctx.params.notes}|${ctx.params.source}|${ctx.params.tuplet}|${ctx.params.depth}|${ctx.params.shortest}`
      if (key !== gridKey) {
        gridKey = key
        grid = []
        for (let d = 0; d <= 3; d++) {
          const err: number[] = []
          for (const sh of [2, 3, 4, 5, 6]) {
            err.push(bestNotation(meant, Math.round(ctx.params.tuplet), d, 2 ** sh).worst)
          }
          grid.push({ depth: d, err })
        }
      }

      const avail = h - pad * 2 - head
      const barH = Math.max(46, Math.min(avail * 0.45, 120))
      const plotH = Math.max(40, avail - barH - 10)
      const barTop = pad + head
      const plotTop = barTop + barH + 10

      const msErr = written.worst * barLen * 1000
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      let two = 1
      let odd = written.den
      while (odd % 2 === 0) {
        odd /= 2
        two *= 2
      }
      g.fillText(
        written.ok
          ? `written over ${written.den}${odd > 1 ? ` = ${two} x ${odd}` : ''}` +
              `   ${written.depth === 0 ? 'no tuplets' : written.depth === 1 ? 'one tuplet' : `${written.depth} nested`}` +
              `   worst note ${msErr.toFixed(1)} ms out` +
              (written.worst < 1e-9 ? '   — exact' : '')
          : `${meant.length} notes do not fit this budget at all — it needs ${written.den}` +
              ` (${written.depth === 1 ? 'one tuplet' : `${written.depth} nested`})`,
        pad,
        pad + 10,
      )

      // -- the bar: meant above, written below ---------------------------------
      const x0 = pad
      const x1 = w - pad
      const sx = (u: number) => x0 + u * (x1 - x0)
      g.fillStyle = 'rgba(255,255,255,0.035)'
      g.fillRect(x0, barTop, x1 - x0, barH)

      // the writable grid this budget gives you
      const den = written.den
      if (den <= 96) {
        g.strokeStyle = 'rgba(255,255,255,0.09)'
        g.lineWidth = 1
        for (let i = 0; i <= den; i++) {
          g.beginPath()
          g.moveTo(sx(i / den), barTop)
          g.lineTo(sx(i / den), barTop + barH)
          g.stroke()
        }
      }

      const yM = barTop + barH * 0.3
      const yW = barTop + barH * 0.72
      let tm = 0
      let tw = 0
      const playhead = ctx.clock.running ? (ctx.audio.currentTime - barAt) / barLen : -1
      for (let i = 0; i < meant.length; i++) {
        const a = sx(tm)
        const b = sx(tw)
        // the gap between them is the error
        g.strokeStyle = 'rgba(248,113,113,0.5)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(a, yM)
        g.lineTo(b, yW)
        g.stroke()

        g.fillStyle = '#34d399'
        g.beginPath()
        g.arc(a, yM, 4, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#7dd3fc'
        g.beginPath()
        g.arc(b, yW, 4, 0, Math.PI * 2)
        g.fill()
        tm += meant[i]
        tw += written.durs[i]
      }
      if (playhead >= 0 && playhead <= 1) {
        g.strokeStyle = 'rgba(255,255,255,0.35)'
        g.beginPath()
        g.moveTo(sx(playhead), barTop)
        g.lineTo(sx(playhead), barTop + barH)
        g.stroke()
      }
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = '#34d399'
      g.fillText('meant', x0 + 2, yM - 7)
      g.fillStyle = '#7dd3fc'
      g.fillText('written', x0 + 2, yW + 14)

      // -- the staircase --------------------------------------------------------
      g.fillStyle = 'rgba(255,255,255,0.035)'
      g.fillRect(pad, plotTop, w - pad * 2, plotH)
      const all = grid.flatMap((r) => r.err).filter((v) => v > 1e-9)
      const top = Math.max(1e-4, Math.max(...all, 1e-4))
      const bot = Math.max(1e-7, Math.min(...all, top) / 2)
      const yOf = (v: number) =>
        plotTop + plotH * (1 - Math.log(Math.max(bot, v) / bot) / Math.log(top / bot))
      const cols = ['#f87171', '#fbbf24', '#7dd3fc', '#34d399']
      for (const row of grid) {
        g.strokeStyle = cols[row.depth]
        g.lineWidth = row.depth === Math.round(ctx.params.depth) ? 2 : 1
        g.globalAlpha = row.depth === Math.round(ctx.params.depth) ? 1 : 0.45
        g.beginPath()
        for (let i = 0; i < row.err.length; i++) {
          const x = pad + 24 + ((w - pad * 2 - 34) * i) / (row.err.length - 1)
          const y = yOf(row.err[i])
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.stroke()
        g.globalAlpha = 1
      }
      // where you are
      const xi = Math.round(ctx.params.shortest) - 2
      const cx = pad + 24 + ((w - pad * 2 - 34) * xi) / 4
      g.strokeStyle = 'rgba(255,255,255,0.3)'
      g.setLineDash([2, 3])
      g.beginPath()
      g.moveTo(cx, plotTop)
      g.lineTo(cx, plotTop + plotH)
      g.stroke()
      g.setLineDash([])

      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(`${(top * barLen * 1000).toFixed(0)} ms`, pad + 1, plotTop + 10)
      g.fillText(`${(bot * barLen * 1000).toFixed(1)}`, pad + 1, plotTop + plotH - 4)
      for (let i = 0; i < 5; i++) {
        const x = pad + 24 + ((w - pad * 2 - 34) * i) / 4
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.fillText(`1/${2 ** (i + 2)}`, x - 7, plotTop + plotH - 4)
      }
      for (const row of grid) {
        g.fillStyle = cols[row.depth]
        g.globalAlpha = row.depth === Math.round(ctx.params.depth) ? 1 : 0.5
        g.fillText(
          row.depth === 0 ? 'none' : `${row.depth} deep`,
          w - pad - 40,
          yOf(row.err[row.err.length - 1]) - 3,
        )
        g.globalAlpha = 1
      }
    })

    const report = () => {
      const ms = written.worst * barLen * 1000
      ctx.status(
        !written.ok
          ? `${meant.length} notes will not fit this budget — writing them needs a denominator of ${written.den}`
          : written.worst < 1e-9
            ? `writable exactly, over ${written.den}`
            : `over ${written.den}, ${written.depth === 0 ? 'no tuplets' : `${written.depth} deep`} — worst note ${ms.toFixed(1)} ms from what was meant`,
      )
    }
    report()
    for (const k of ['notes', 'source', 'seed', 'tuplet', 'depth', 'shortest'] as const) {
      ctx.onParam(k, report)
    }

    // Read back by the harness; the sketch's numbers come from the same module.
    ;(window as unknown as Record<string, unknown>).__tuplet = () => ({
      tap: () => bus,
      set: (k: string, v: number | boolean | string) => ctx.set(k as never, v as never),
      meant: () => meant.slice(),
      written: () => ({ ...written, durs: written.durs.slice(), parts: written.parts.slice() }),
      barLen: () => barLen,
      levels: (d: number, n: number) => levels(d, n),
    })
  },
})
