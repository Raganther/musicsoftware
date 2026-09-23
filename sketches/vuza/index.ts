import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  complements,
  entryLoop,
  isAperiodic,
  ownership,
  periods,
  rhythmLoop,
  tiles,
  type Canon,
} from './canon'

/**
 * A canon on 72 pulses in which nothing repeats, and the two canons where
 * something does.
 *
 * `tiling` (2026-08-10) found the entry points that make a drawn rhythm fill a
 * cycle exactly once. It never asked the next question: is the canon it found
 * secretly a *loop*? A set is periodic when some shift maps it to itself, which
 * for a rhythm means it is a shorter pattern repeated. Almost every tiling canon
 * has a periodic half — Hajós asked in 1949 whether all of them do, and the
 * answer turns out to be no, but not until **n = 72**.
 *
 * So the three settings of `Which half loops` are three canons with the same
 * six-note subject, the same twelve entries and the same 72 pulses, differing
 * only in which half is a loop. The first has none, and below 72 pulses no such
 * canon exists at any density.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-23-vuza.md`.
 */

const N = 72
const VOICES = 12
const SUBJECT = 6

/**
 * One of exactly three subjects at this length that admit an aperiodic partner,
 * out of 47,821 that are aperiodic and tile. Every entry set is found by search
 * at load — 1296 of them, 432 aperiodic — so `seed` really does pick a different
 * Vuza canon rather than a different corner of one.
 */
const VUZA_SUBJECT = [0, 8, 16, 18, 26, 34]

const COLOURS = [
  '#7dd3fc',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#fb923c',
  '#4ade80',
  '#60a5fa',
  '#f87171',
  '#c4b5fd',
  '#2dd4bf',
  '#facc15',
]

/** Six warm greys for position within the subject — deliberately not the voice palette. */
const SLOTS = ['#1f2937', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db']

export default defineSketch({
  title: 'Vuza',
  description: 'A twelve-voice canon that fills 72 pulses exactly once and never repeats inside them.',
  tags: ['rhythm', 'sequencer', 'canon'],
  status: 'promising',
  bpm: 126,
  division: 4,

  params: {
    /**
     * The same split — six notes, twelve entries, 72 pulses — with the loop
     * moved. Only the first has neither half periodic, and below n = 72 it does
     * not exist.
     */
    canon: {
      type: 'select',
      value: 'neither (Vuza)',
      options: ['neither (Vuza)', 'the subject loops', 'the entries loop'],
      label: 'Which half loops',
    },
    /** Picks one of the 432 aperiodic entry sets, and the subject's contour. */
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1, label: 'Seed' },
    /** Scale degrees between one voice and the next, in order of entry. */
    spread: { type: 'number', value: 1, min: 0, max: 3, step: 0.05, label: 'Voice spread' },
    /** How far the six notes of the subject roam within a voice. */
    contour: { type: 'number', value: 2.5, min: 0, max: 6, step: 0.1, label: 'Subject contour' },
    /** 0 plays everything; 1–12 fades all but one voice, so you hear the subject. */
    solo: { type: 'number', value: 0, min: 0, max: VOICES, step: 1, label: 'Solo voice' },
    decay: { type: 'number', value: 0.42, min: 0.06, max: 1.4, step: 0.01, label: 'Decay' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    root: { type: 'number', value: 45, min: 30, max: 62, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMajor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
  },

  notes: `
A tiling canon fills a cycle exactly once: a subject \`a\`, a set of entries
\`b\`, and \`a ⊕ b = Z_n\` — no gaps, no collisions. \`tiling\` searched for
\`b\` given \`a\`. The question it never asked is whether the canon it found is
secretly a **loop**.

A set is *periodic* when some nonzero shift maps it to itself, so a periodic
subject is a shorter rhythm repeated, and a periodic entry set is the voices
coming in on a cycle. **Hajós, 1949: must every tiling canon have a periodic
half?** For a cyclic group the answer is no, and the smallest length where it
fails is 72 — the canons that get through are Vuza's, classified in 1991. The
three settings of \`Which half loops\` are the same 6 × 12 split with the loop
moved.

**Complete enumeration, counting subjects up to translation.** For every n ≤ 60
except 49 and 56, a factor pair always has a side of six notes or fewer, so
"every split whose smaller half fits" is in fact every split:

| n | splits enumerated | subjects tried | aperiodic tiling subjects | **both halves aperiodic** |
| --- | --- | --- | --- | --- |
| 24 | 2×12 3×8 4×6 | 2,047 | 103 | **0** |
| 36 | 2×18 3×12 4×9 6×6 | 331,807 | 1,713 | **0** |
| 48 | 2×24 3×16 4×12 6×8 | 1,551,282 | 6,970 | **0** |
| 60 | 2×30 3×20 4×15 5×12 6×10 | 5,495,791 | 23,873 | **0** |
| **72** | 2×36 3×24 4×18 6×12 | 13,079,620 | 50,063 | **1,296** |

Across all of 2 → 60 that is **11,913,350 subjects and not one Vuza canon**. The
only splits not enumerated anywhere are 7×7 at 49, 7×8 at 56 and 8×9 at 72.

**And they are vanishingly rare where they do exist.** In the 6 × 12 split at
72, **47,821** subjects are aperiodic and tile, and exactly **3** of them have
an aperiodic partner — 432 entry sets each, which is 6 up to translation. One
subject in sixteen thousand.

**A repeat inside a rhythm is not the same as the rhythm being a repeat.** The
subject here is \`{0,8,16} ⊕ {0,18}\`, so **48 of the 72 pulses keep their owner
under a shift of 8** — and still no shift maps it to itself.

**What the sketch plays is verified at load, not asserted.** The entry sets come
from the same backtracking search as \`tiling\`: 1296 complements of
\`{0,8,16,18,26,34}\`, of which **432 are aperiodic**, and \`seed\` picks among
those. The panel shows the shortest shift that maps each half to itself, or
\`never\`.

**Read back off a recording**, with the contour flat so the k-th lowest pitch is
voice k: **149 onsets on 149 consecutive pulses, none doubled, 149/149 voices
correct**, against 14–34/149 for a different canon. Shift the heard sequence and
rename the voices and the two controls come back onto themselves at ten shifts
and at five; the Vuza canon at **none**.

**The controls are the same density and give themselves away inside a second.**
\`the subject loops\` is six notes every twelve pulses in every voice; \`the
entries loop\` is twelve voices coming in every six. Both fill 72 pulses exactly
once, exactly as the Vuza canon does.

Levels: 0.492 at the defaults, 0.747 worst over thirteen settings.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.1 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the canon -------------------------------------------------------------

    /** Every aperiodic complement of the subject, found once and kept. */
    let pool: number[][] = []
    let canon: Canon = { n: N, a: VUZA_SUBJECT, b: [] }
    let own: Int32Array<ArrayBufferLike> = new Int32Array(N)
    /** Index of each pulse within its voice's subject, 0..5. */
    let slot = new Int32Array(N)
    let pitches: number[] = []
    let aPeriod = 0
    let bPeriod = 0
    let good = false

    const findPool = () => {
      const all = complements(N, VUZA_SUBJECT)
      pool = all.filter((b) => isAperiodic(N, b))
    }
    findPool()

    const rebuild = () => {
      const which = ctx.params.canon
      const seed = Math.round(ctx.params.seed)
      if (which === 'the subject loops') canon = rhythmLoop(N, SUBJECT)
      else if (which === 'the entries loop') canon = entryLoop(N, SUBJECT)
      else {
        const b = pool.length ? pool[(seed * 37) % pool.length] : []
        canon = { n: N, a: VUZA_SUBJECT, b }
      }

      // The claim, re-checked every time rather than trusted: it tiles, and
      // these are the shortest shifts that map each half to itself.
      good = canon.b.length === VOICES && tiles(N, canon.a, canon.b)
      const pa = periods(N, canon.a)
      const pb = periods(N, canon.b)
      aPeriod = pa.length ? pa[0] : 0
      bPeriod = pb.length ? pb[0] : 0

      // Voices are numbered by when they come in, so `spread` walks up the
      // scale as the canon fills.
      const order = canon.b.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
      const rank = new Int32Array(VOICES)
      order.forEach(([, i], r) => (rank[i] = r))

      // `ownership` numbers voices by their position in `b`; re-index by entry
      // rank, and record which note of the subject each pulse is.
      const raw = ownership(N, canon.a, canon.b)
      own = new Int32Array(N)
      slot = new Int32Array(N)
      for (let t = 0; t < N; t++) own[t] = raw[t] < 0 ? -1 : rank[raw[t]]
      const sorted = [...canon.a].sort((p, q) => p - q)
      for (let j = 0; j < canon.b.length; j++) {
        for (let k = 0; k < sorted.length; k++) slot[(sorted[k] + canon.b[j]) % N] = k
      }

      // The subject's own line: one contour, shared by every voice, so what you
      // hear twelve times is the same tune.
      const r = rng(seed * 13 + 5)
      const shape: number[] = []
      let d = 0
      for (let k = 0; k < SUBJECT; k++) {
        shape.push(d)
        d = clamp(d + r.int(-2, 3), -3, 4)
      }

      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      const sp = ctx.params.spread
      const co = ctx.params.contour / 3
      pitches = []
      for (let v = 0; v < VOICES; v++) {
        for (let k = 0; k < SUBJECT; k++) {
          // Clamped: twelve voices at the widest spread over a pentatonic span
          // eight octaves, and the top of that is above Nyquist rather than
          // shrill. Voices sharing a pitch is fine — only one sounds per pulse.
          pitches.push(clamp(degree(rootN, scale, Math.round(v * sp + shape[k] * co)), 24, 96))
        }
      }
    }
    rebuild()
    for (const k of ['canon', 'seed', 'spread', 'contour', 'root', 'scale'] as const) ctx.onParam(k, rebuild)

    // -- the sound -------------------------------------------------------------

    /** A woody FM pluck: ratio 3 with an index that decays far faster than the note. */
    const strike = (v: number, k: number, time: number, gain: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const f = mtof(pitches[v * SUBJECT + k])
      const dec = ctx.params.decay

      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = -0.62 + (v / (VOICES - 1)) * 1.24
      pn.connect(bus)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // 6 ms, not 1 — a fast ramp on a sine is a broadband click, and there is
      // a note on every single pulse here
      amp.gain.linearRampToValueAtTime(gain, at + 0.006)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.012), at + dec)
      amp.connect(pn)

      const car = ctx.audio.createOscillator()
      car.type = 'sine'
      car.frequency.value = f
      car.connect(amp)

      const mod = ctx.audio.createOscillator()
      mod.type = 'sine'
      mod.frequency.value = f * 3
      const idx = ctx.audio.createGain()
      idx.gain.setValueAtTime(f * 2.6, at)
      idx.gain.exponentialRampToValueAtTime(f * 0.02, at + Math.min(0.09, dec * 0.4))
      mod.connect(idx).connect(car.frequency)

      car.start(at)
      mod.start(at)
      disposeAt(car, at + dec + 0.08, [amp, pn])
      disposeAt(mod, at + dec + 0.08, [idx])
    }

    // -- the transport ----------------------------------------------------------

    /** How many notes landed on each pulse over the last few cycles — the tiling, read back. */
    const hits = new Int32Array(N)
    let cycles = 0
    let base = -1

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const m = e.step - base
      const pulse = m % N
      if (pulse === 0 && m > 0) cycles++

      const v = own[pulse]
      if (v < 0 || !good) return

      // A note on every pulse means decay/step of them overlap, and at a 1.4 s
      // decay that is fifteen. Scale by the overlap, normalised so the defaults
      // are untouched.
      const stacked = ctx.params.decay / Math.max(1e-6, e.dur)
      let lvl = (0.52 + ctx.params.level * 0.60) * Math.sqrt(2.2 / Math.max(2.2, stacked))
      const solo = Math.round(ctx.params.solo)
      if (solo > 0) lvl *= v === solo - 1 ? 1.25 : 0.1

      strike(v, slot[pulse], e.time, lvl)
      hits[pulse]++
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          cycles = 0
          hits.fill(0)
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const vs = ctx.clock.visualStep
      const here = base < 0 ? -1 : ((vs - base) % N + N) % N

      const gridW = w - pad * 2
      const cw = gridW / N
      const rowH = Math.max(12, Math.min(26, (h - pad * 2 - 46) / 2))
      const y0 = pad + 14

      // Two readings of the same 72 pulses, and each one makes a different kind
      // of loop *visible*. A periodic subject leaves the owner unchanged under
      // its shift, so the top strip repeats literally; a periodic entry set
      // leaves the position-in-subject unchanged, so the bottom one does. A
      // Vuza canon has no period in either, and the dividers never appear.
      const strips: [string, readonly string[], (t: number) => number, number][] = [
        ['who plays it', COLOURS, (t) => own[t], aPeriod],
        ['where in the subject', SLOTS, (t) => slot[t], bPeriod],
      ]
      g.font = '10px ui-monospace, monospace'
      g.textBaseline = 'alphabetic'
      strips.forEach(([label, palette, pick, period], si) => {
        const y = y0 + si * (rowH + 18)
        g.fillStyle = '#64748b'
        g.fillText(label, pad, y - 4)
        for (let t = 0; t < N; t++) {
          const c = pick(t)
          g.fillStyle = c < 0 ? '#1e293b' : palette[c % palette.length]
          g.fillRect(pad + t * cw, y, Math.max(1, cw - 0.8), rowH)
        }
        // Where it comes back onto itself, if it ever does.
        if (period) {
          g.strokeStyle = '#f8fafc'
          g.lineWidth = 1
          for (let t = period; t < N; t += period) {
            g.beginPath()
            g.moveTo(pad + t * cw - 0.4, y - 2)
            g.lineTo(pad + t * cw - 0.4, y + rowH + 2)
            g.stroke()
          }
        }
        if (here >= 0) {
          g.fillStyle = '#fff'
          g.fillRect(pad + here * cw, y - 3, Math.max(1.5, cw - 0.8), rowH + 6)
        }
      })

      const ty = y0 + 2 * (rowH + 18) + 4
      g.font = '11px ui-monospace, monospace'
      const say = (p: number) => (p ? `repeats every ${p}` : 'never repeats')
      const wide = w > 640
      g.fillStyle = '#94a3b8'
      g.fillText(`subject ${say(aPeriod)}`, pad, ty + 10)
      g.fillText(`entries ${say(bPeriod)}`, wide ? pad + gridW * 0.34 : pad, ty + (wide ? 10 : 24))

      const struck = hits.reduce((s, x) => s + (x > 0 ? 1 : 0), 0)
      const doubled = hits.reduce((s, x) => s + (x > cycles + 1 ? 1 : 0), 0)
      g.fillStyle = good ? '#4ade80' : '#f87171'
      g.fillText(
        good ? `${struck}/72 struck, ${doubled} doubled` : 'not a tiling — this should never print',
        wide ? pad + gridW * 0.68 : pad + gridW * 0.5,
        ty + (wide ? 10 : 24),
      )
    })

    ctx.status(`${pool.length} aperiodic entry sets found for the subject`)
  },
})
