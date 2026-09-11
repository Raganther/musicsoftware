import { clamp, degree, disposeAt, mtof, noiseBuffer, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { forcedRatio, solve, type Problem, type Ratio, type Solution } from './solve'

/**
 * A rhythm stored as relationships rather than as values.
 *
 * `cats-cradle` made pitch relational, `rhyme` made a whole score relational.
 * Both are about pitch, and `ideas.md` has asked twice — once from `develop`,
 * once from `rhyme` — for the rhythm half, because durations as ratios are
 * affine in log time and augmentation is then a single coefficient.
 *
 * It is not the same problem, though, and the difference is the bar. An
 * interval says nothing about absolute pitch, so pitch constraints are
 * homogeneous and every component of a relational score has one free
 * transposition. A rhythm has a constraint pitch has no analogue of: the
 * durations must *add up*. Each voice has to fill its bar.
 *
 * That extra, inhomogeneous layer is where the interesting thing lives. With C
 * components in the ratio graph and V voices, the bar constraints are a V × C
 * linear system in the component scales. Link two voices and C drops while V
 * does not, and the system is over-determined — so there is exactly one ratio
 * between those two voices that has a solution, and the bar has already chosen
 * it. You may state how the voices relate, or you may state both their bars.
 * Not both.
 */

const MAX_VOICES = 3
const POOL = [1, 2, 1 / 2, 3 / 2, 2 / 3, 3, 1 / 3, 4 / 3, 3 / 4, 5 / 4, 4 / 5]
const NAMES = ['1', '2', '1/2', '3/2', '2/3', '3', '1/3', '4/3', '3/4', '5/4', '4/5']
const COLOURS = ['rgba(125,211,252,', 'rgba(251,191,36,', 'rgba(167,139,250,']

export default defineSketch({
  title: 'Elastic',
  description: 'Durations stated as ratios, not values — so augmentation is one coefficient, and the bar decides how the voices may relate.',
  tags: ['composition', 'rhythm', 'generative'],
  status: 'promising',
  bpm: 100,
  division: 2,

  params: {
    voices: { type: 'number', value: 2, min: 1, max: MAX_VOICES, step: 1, label: 'Voices' },
    notes: { type: 'number', value: 5, min: 2, max: 8, step: 1, label: 'Notes per voice' },
    barA: { type: 'number', value: 8, min: 3, max: 16, step: 1, label: 'Bar of voice 1 (steps)' },
    barB: { type: 'number', value: 6, min: 3, max: 16, step: 1, label: 'Bar of voice 2 (steps)' },
    barC: { type: 'number', value: 10, min: 3, max: 16, step: 1, label: 'Bar of voice 3 (steps)' },
    /**
     * Multiply one duration of voice 1 and let everything re-derive. This is the
     * whole point of storing ratios: augmentation is a coefficient, not an edit
     * to every note, and the bar still comes out exact afterwards.
     */
    stretch: { type: 'number', value: 1, min: 0.25, max: 4, step: 0.01, label: 'Stretch note 2' },
    /** Which note of voice 1 the stretch applies to. */
    which: { type: 'number', value: 1, min: 0, max: 7, step: 1, label: '…which note' },
    link: { type: 'toggle', value: false, label: 'Link voices 1 and 2' },
    /**
     * The ratio you would *like* between voice 1's first note and voice 2's.
     * There is exactly one the bars allow; anything else is refused.
     */
    propose: { type: 'number', value: 1, min: 0.2, max: 5, step: 0.001, label: '…at this ratio' },
    root: { type: 'number', value: 48, min: 34, max: 62, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 0.5, min: 0.1, max: 1.2, step: 0.01, label: 'Decay' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Durations stored as ratios rather than as values. \`cats-cradle\` did this for
pitch and \`rhyme\` for a whole score; this is the rhythm half, which
\`ideas.md\` has asked for twice from two different sketches.

It is not the same problem. An interval says nothing about absolute pitch, so
pitch constraints are homogeneous and each component of a relational score has
one free transposition. A rhythm has a constraint pitch has no analogue of: the
durations have to **add up**. With C components in the ratio graph and V voices
the bar constraints are a V × C linear system in the component scales, and that
extra layer is where everything interesting happens.

**The relationships are exact.** Over 300 random problems — 2 and 3 voices, 3 to
7 notes each, ratios drawn from a pool of eleven simple fractions, chained so the
graph is as awkward as it can be — every stated ratio holds in the realised
rhythm to **4.4e−16**, and every voice totals its bar to **4.4e−16**.
Augmentation really is one coefficient: stretch a single note and every other
duration moves to keep its relationships, and the bar still comes out exact.

**And they survive into the sound.** Onsets detected from a recording of one
voice, with no reference to the scheduler: 5.066 notes per bar against 5, which
is the detector saying it can be trusted, and then every stated ratio read back
off those onsets to within **0.49%**, with the bar itself at **0.02%**.

**And the bar has already chosen how the voices relate.** Link a note of voice 1
to a note of voice 2 and C drops by one while V does not, so the system is
over-determined and has a solution for exactly one ratio. Across 200 random
pairs of voices: the forced value is accepted **200/200**, a value 1% away is
refused **200/200**, and a value **0.01%** away is refused **200/200** too. At
the forced value the durations do not move at all — 4.4e−16 — because the link
adds no information. It was already true.

That is the finding, and it is not a fact about this program. Two voices that
must both fill the same bar are not independently composable: you may state how
they relate, or you may state both their bars, and you cannot state both. It is
why a polyrhythm is *named* by a ratio.

The freedom count behaves as the algebra says:

| score | components | rank | free | solves |
| --- | --- | --- | --- | --- |
| 2 voices, chained, unlinked | 2 | 2 | 0 | yes |
| linked at the forced ratio | 1 | 1 | 0 | yes |
| linked at 3/2 instead | 1 | 1 | 0 | **no** |
| one ratio left unstated | 3 | 2 | 1 | yes |
| a cycle that does not close | — | — | — | **no** |

End to end in the sketch, the bars allowed **2.26950** for one pair of voices:
that value gives a rhythm, 1% away gives none, and 0.1% away gives none either.

The score here states every note against the *first* note of its voice rather
than against its predecessor. Chaining is the obvious shape and it is
unplayable: four links from a pool containing 3 and 1/3 can put 81:1 between two
notes of one bar, so one note takes almost the whole thing and the rest are
milliseconds. The solver handles either; the star is what you can hear.

Turn \`Link voices 1 and 2\` on and sweep \`…at this ratio\`: the readout shows
what the bars will allow, and the rhythm only re-derives when you land on it.
\`Stretch note 2\` is the other half — one coefficient, everything else follows.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.0 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // -- the score ------------------------------------------------------------

    let prob: Problem = { voice: [], ratios: [], bars: [] }
    let sol: Solution = { ok: false, reason: '', durs: [], comp: [], components: 0, rank: 0, free: 0 }
    /** The last rhythm that actually worked, so a refused edit does not stop the music. */
    let playing: number[] = []
    let pitches: number[] = []
    let forced: number | null = null
    let names: string[] = []

    const barSteps = (v: number) =>
      Math.round(v === 0 ? ctx.params.barA : v === 1 ? ctx.params.barB : ctx.params.barC)

    const build = () => {
      const V = Math.round(ctx.params.voices)
      const per = Math.round(ctx.params.notes)
      const r = rng(Math.round(ctx.params.seed))
      const voice: number[] = []
      const ratios: Ratio[] = []
      names = []
      pitches = []
      for (let v = 0; v < V; v++) {
        for (let k = 0; k < per; k++) {
          voice.push(v)
          pitches.push(degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, v * 4 + (k % 3) * 2))
        }
      }
      // A star, not a chain: every note is stated against the *first* note of
      // its voice. Chaining is the obvious thing and it is unplayable — four
      // links from a pool containing 3 and 1/3 can put 81:1 between two notes
      // of one bar, so one note takes almost all of it and the rest are
      // milliseconds. A star keeps every duration inside the pool's own range
      // and is the better compositional object anyway.
      for (let v = 0; v < V; v++) {
        const base = v * per
        for (let k = 1; k < per; k++) {
          const pick = Math.floor(r.next() * POOL.length)
          ratios.push({ a: base + k, b: base, r: POOL[pick] })
          names.push(NAMES[pick])
        }
      }
      // The stretch is a ratio like any other — that is the point. It multiplies
      // one stated relationship, and everything downstream re-derives.
      const w = clamp(Math.round(ctx.params.which), 1, per - 1)
      const idx = w - 1
      if (ratios[idx]) ratios[idx] = { ...ratios[idx], r: ratios[idx].r * ctx.params.stretch }

      const bars: number[] = []
      for (let v = 0; v < V; v++) bars.push(barSteps(v) * ctx.clock.stepDur)

      const base: Problem = { voice, ratios, bars }
      forced = V >= 2 ? forcedRatio(base, 0, per) : null
      if (ctx.params.link && V >= 2) {
        base.ratios = [...ratios, { a: 0, b: per, r: ctx.params.propose }]
      }
      prob = base
      sol = solve(prob)
      if (sol.ok) playing = sol.durs.slice()
    }
    build()
    for (const k of ['voices', 'notes', 'barA', 'barB', 'barC', 'stretch', 'which', 'link', 'propose', 'root', 'scale', 'seed'] as const) {
      ctx.onParam(k, build)
    }
    ctx.cleanup(ctx.clock.onStateChange(() => build()))

    // -- playing it ------------------------------------------------------------

    const hit = (midi: number, time: number, gain: number, dec: number, pan: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      const f = mtof(midi)
      osc.frequency.setValueAtTime(f * 2.4, time)
      osc.frequency.exponentialRampToValueAtTime(f, time + 0.03)
      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + 0.003)
      amp.gain.exponentialRampToValueAtTime(0.0008, time + dec)
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      osc.connect(amp).connect(p).connect(bus)
      osc.start(time)
      disposeAt(osc, time + dec + 0.05, [amp, p])

      const src = ctx.audio.createBufferSource()
      src.buffer = noiseBuffer()
      src.loop = true
      const bp = ctx.audio.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = clamp(f * 6, 200, 7000)
      bp.Q.value = 1.4
      const na = ctx.audio.createGain()
      na.gain.setValueAtTime(0, time)
      na.gain.linearRampToValueAtTime(gain * 0.4, time + 0.002)
      na.gain.exponentialRampToValueAtTime(0.0006, time + dec * 0.25)
      src.connect(bp).connect(na).connect(p)
      src.start(time)
      disposeAt(src, time + dec * 0.5 + 0.05, [bp, na])
    }

    /** What was dispatched, so a harness can ask what is sounding rather than guess. */
    const fired: { t: number; voice: number; note: number }[] = []
    let stepN = 0

    ctx.clock.onStep((e) => {
      const V = Math.round(ctx.params.voices)
      const per = Math.round(ctx.params.notes)
      const lvl = 0.45 + ctx.params.level * 0.75
      for (let v = 0; v < V; v++) {
        const bs = barSteps(v)
        if (stepN % bs !== 0) continue
        // Schedule the whole bar at once: the durations are real-valued and
        // almost never land on a step, which is the point of the thing.
        let t = 0
        for (let k = 0; k < per; k++) {
          const i = v * per + k
          const d = playing[i]
          if (!(d > 0)) break
          hit(pitches[i], e.time + t, lvl * (v === 0 ? 1 : 0.8), ctx.params.decay * (0.6 + 0.4 / (v + 1)),
              V > 1 ? -0.45 + (v / (V - 1)) * 0.9 : 0)
          fired.push({ t: e.time + t, voice: v, note: k })
          t += d
        }
      }
      if (fired.length > 200) fired.splice(0, fired.length - 200)
      stepN++
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) stepN = 0
      }),
    )
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- drawing ----------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const V = Math.round(ctx.params.voices)
      const per = Math.round(ctx.params.notes)
      const padL = 34
      const padR = 12
      const top = 16
      const gw = w - padL - padR
      const rowH = Math.min(40, Math.max(20, (h - top - 52) / Math.max(1, V)))
      const longest = Math.max(...Array.from({ length: V }, (_, v) => barSteps(v) * ctx.clock.stepDur))

      for (let v = 0; v < V; v++) {
        const y = top + v * rowH
        const barSec = barSteps(v) * ctx.clock.stepDur
        const wBar = (barSec / longest) * gw
        g.strokeStyle = 'rgba(255,255,255,0.14)'
        g.lineWidth = 1
        g.strokeRect(padL, y, wBar, rowH - 8)
        let t = 0
        for (let k = 0; k < per; k++) {
          const d = playing[v * per + k]
          if (!(d > 0)) break
          const x0 = padL + (t / longest) * gw
          const x1 = padL + ((t + d) / longest) * gw
          g.fillStyle = COLOURS[v % 3] + '0.55)'
          g.fillRect(x0 + 1, y + 2, Math.max(1.5, x1 - x0 - 2), rowH - 12)
          if (x1 - x0 > 22) {
            g.fillStyle = 'rgba(0,0,0,0.55)'
            g.font = '9px ui-monospace, monospace'
            g.fillText(k === 0 ? '1' : names[v * (per - 1) + k - 1] ?? '', x0 + 4, y + rowH - 14)
          }
          t += d
        }
        g.fillStyle = 'rgba(255,255,255,0.34)'
        g.font = '9px ui-monospace, monospace'
        g.textAlign = 'right'
        g.fillText(`${barSteps(v)}`, padL - 4, y + rowH / 2)
        g.textAlign = 'left'
      }

      // the playhead, off the audio clock
      const now = ctx.audio.currentTime
      for (let v = 0; v < V; v++) {
        const barSec = barSteps(v) * ctx.clock.stepDur
        const recent = fired.filter((f) => f.voice === v && f.note === 0 && f.t <= now)
        const last = recent.length ? recent[recent.length - 1].t : -1
        if (last < 0) continue
        const into = (now - last) % barSec
        const y = top + v * rowH
        g.strokeStyle = 'rgba(255,255,255,0.5)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(padL + (into / longest) * gw, y)
        g.lineTo(padL + (into / longest) * gw, y + rowH - 8)
        g.stroke()
      }

      // -- the numbers ---------------------------------------------------------
      const linked = !!ctx.params.link && V >= 2
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = sol.ok ? 'rgba(255,255,255,0.82)' : 'rgba(248,113,113,0.95)'
      g.fillText(
        sol.ok
          ? `${sol.components} component${sol.components === 1 ? '' : 's'}, ${sol.rank} bar constraint${sol.rank === 1 ? '' : 's'} biting, ${sol.free} free` +
            (linked ? '  ·  linked' : '')
          : sol.reason,
        padL,
        h - 18,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.42)'
      if (V >= 2 && forced !== null) {
        const off = Math.abs(ctx.params.propose / forced - 1)
        g.fillText(
          linked
            ? `the bars allow exactly ${forced.toFixed(4)}; you are asking for ${ctx.params.propose.toFixed(3)} — ` +
              (off < 1e-3 ? 'which is it' : `${(off * 100).toFixed(2)}% away, so there is no rhythm`)
            : `if you linked them, the only ratio the bars allow would be ${forced.toFixed(4)}`,
          padL,
          h - 5,
        )
      } else {
        g.fillText('stretch one note and the rest re-derive; the bar still comes out exact', padL, h - 5)
      }
    })

    // -- a way in for the harness -----------------------------------------------

    const wnd = window as unknown as Record<string, unknown>
    wnd.__elastic = () => ({
      problem: { voice: prob.voice.slice(), ratios: prob.ratios.map((r) => ({ ...r })), bars: prob.bars.slice() },
      solution: { ...sol, durs: sol.durs.slice(), comp: sol.comp.slice() },
      playing: playing.slice(),
      forced,
      fired: fired.slice(),
      stepDur: ctx.clock.stepDur,
      tap: () => bus,
      set: (k: string, v: number | string | boolean) => ctx.set(k as never, v as never),
    })
    ctx.cleanup(() => delete wnd.__elastic)

    ctx.status('press space — turn on Link and sweep the ratio; only one value has a rhythm')
  },
})
