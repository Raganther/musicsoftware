import { clamp, disposeAt, mtof, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  aggregate,
  intervalVector,
  isAllCombinatorial,
  partners,
  rowFrom,
  setClass,
  transform,
  type Kind,
  type PCSet,
  type Row,
} from './rows'

/**
 * Two six-note halves that complete each other — the aggregate, tiled.
 *
 * `tiling`, `hocket`, `nest` and `vuza` all partition *time* exactly: every
 * pulse struck once, no gaps and no collisions. `research/ideas.md` has been
 * asking for the same thing in pitch since `nest`. It has a name.
 *
 * A twelve-tone row splits into two hexachords, and the row is **hexachordally
 * combinatorial** when some transformation begins with the six notes the
 * original ends with. Run the two together and every half-row is all twelve
 * pitch classes exactly once. Schoenberg's device, and the reason serial music
 * can be contrapuntal without anything doubling.
 *
 * There is no `scale` param because a row has no scale; `root` is the
 * transposition, which is the only thing a row can be transposed by.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-26-dovetail.md`.
 */

/** Babbitt's six source sets: the only hexachords combinatorial under all four. */
const SOURCES: Record<string, PCSet> = {
  'A (012345)': [0, 1, 2, 3, 4, 5],
  'B (023457)': [0, 2, 3, 4, 5, 7],
  'C (024579)': [0, 2, 4, 5, 7, 9],
  'D (012678)': [0, 1, 2, 6, 7, 8],
  'E (014589)': [0, 1, 4, 5, 8, 9],
  'F (02468T)': [0, 2, 4, 6, 8, 10],
  'free (from the seed)': [],
}
const SOURCE_NAMES = Object.keys(SOURCES)

export default defineSketch({
  title: 'Dovetail',
  description: 'Two hexachords that complete each other — the twelve-tone aggregate as an exact partition of pitch.',
  tags: ['composition', 'serial', 'generative'],
  status: 'promising',
  bpm: 96,
  division: 4,

  params: {
    /** Which hexachord the row is built on. The first six decide everything. */
    hexachord: { type: 'select', value: 'C (024579)', options: SOURCE_NAMES, label: 'Hexachord' },
    /** Which transformation the second voice plays. `broken` is the control. */
    partner: {
      type: 'select',
      value: 'I',
      options: ['P', 'I', 'R', 'RI', 'broken'],
      label: 'Second voice',
    },
    /** Simultaneous is Schoenberg's texture; alternating is a hocket in pitch. */
    texture: { type: 'select', value: 'together', options: ['together', 'alternating'], label: 'Texture' },
    /** Octaves between the two voices. At 0 a collision is a unison. */
    spread: { type: 'number', value: 1, min: 0, max: 3, step: 1, label: 'Voice spread' },
    /** Steps per note. */
    rate: { type: 'number', value: 2, min: 1, max: 6, step: 1, label: 'Steps per note' },
    root: { type: 'number', value: 3, min: 0, max: 11, step: 1, label: 'Root' },
    octave: { type: 'number', value: 4, min: 2, max: 6, step: 1, label: 'Octave' },
    decay: { type: 'number', value: 0.55, min: 0.08, max: 1.6, step: 0.01, label: 'Decay' },
    space: { type: 'number', value: 0.3, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 6, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
This repo has tiled *time* exactly four times — \`tiling\`, \`hocket\`, \`nest\`,
\`vuza\` — and the same question in pitch has a name. A twelve-tone row splits
into two hexachords; the row is **hexachordally combinatorial** when some
transformation begins with the six notes the original ends with. Run the two
together and every half-row is all twelve pitch classes exactly once.

**Babbitt's theorem, over every hexachord there is.** A hexachord and its
complement have the same interval vector: **identical for 924 of 924**. Two
halves of the aggregate cannot help sounding alike.

**Which hexachords are combinatorial, of the 924:**

| kind | count |
| --- | --- |
| P | 72 |
| I | 348 |
| R | **924** |
| RI | 216 |
| all four | 48 |

Retrograde works for *every* hexachord, because the retrograde of a row starts
with the notes the row finished with — that is a fact about the word, not about
the hexachord, and the content is in P, I and RI.

**The 48 are six set classes and they are the published six.** Found by search,
labelled by prime form:

| | prime form | members |
| --- | --- | --- |
| A | (012345) | 12 |
| B | (023457) | 12 |
| C | (024579) | 12 |
| D | (012678) | 6 |
| E | (014589) | 4 |
| F | (02468T) | 2 |

12+12+12+6+4+2 = 48, and each count is that set's own transpositional symmetry —
D maps to itself at 6, E at 4, F at 2.

**Combinatoriality belongs to the unordered hexachord, so the tune is free.**
Reordering the row inside each half 200 times, for each of the six: still
combinatorial **200/200**, and with the identical set of partners 200/200. You
may compose the melody however you like.

**Most rows have no partner at all.** Over all 924 hexachords, counting the
forms that dovetail: **384 have only the trivial retrograde**, 480 have two, and
only 12 have more than four. The whole-tone hexachord has 24.

**Off the sound.** In \`alternating\` texture the voices hocket, so one note
sounds at a time and every twelve consecutive notes are one half-row of each
voice. The tap is armed before the transport starts, so note 0 is note 0 and no
alignment is guessed at:

| hexachord | second voice | distinct pitch classes per aligned twelve |
| --- | --- | --- |
| C (024579) | I | **12 12 12 12** |
| C (024579) | P | **12 12 12 12** |
| A (012345) | I | **12 12 12 12** |
| F (02468T) | P | **12 12 12 12** |
| C (024579) | broken | 8 8 8 8 |
| free, from the seed | I | 10 10 10 10 |
| free, from the seed | P | 9 9 9 9 |

**And the alignment is special, which is the part worth checking.** Counting
distinct pitch classes at every offset, not just the right one:

\`\`\`
C (024579) I        12.0 11.0 10.0 9.0 8.0 7.0 6.0 7.0 8.0 9.0 10.0 11.0
C (024579) broken    8.0  8.0  9.0 8.0 9.0 8.0 8.0 7.0 8.0 7.0  8.0  7.0
\`\`\`

A clean V that touches twelve exactly once, against a flat row that never
reaches it at any offset.

\`Second voice: broken\` is the control. Asking for a partner the hexachord
cannot give you is the other one — the aggregate breaks, and the panel says
which partner does not exist rather than quietly handing you the retrograde.

Levels: 0.496 at the defaults, 0.700 worst over twelve settings.
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

    // -- the rows --------------------------------------------------------------

    let rowA: Row = []
    let rowB: Row = []
    let hex: PCSet = []
    let label = ''
    let chosen: { kind: Kind; t: number } | null = null
    let combinatorial = false
    let available = true
    let spans: ReturnType<typeof aggregate> = []

    const build = () => {
      const r = rng(Math.round(ctx.params.seed))
      const name = ctx.params.hexachord
      const base = SOURCES[name]
      if (base && base.length === 6) {
        hex = base.map((x) => (x + Math.round(ctx.params.root)) % 12).sort((a, b) => a - b)
      } else {
        // a hexachord off the seed, which is usually not combinatorial at all
        const pool = Array.from({ length: 12 }, (_, i) => i)
        for (let i = 11; i > 0; i--) {
          const j = r.int(0, i)
          ;[pool[i], pool[j]] = [pool[j], pool[i]]
        }
        hex = pool.slice(0, 6).sort((a, b) => a - b)
      }

      const shuffle = (n: number) => {
        const a = Array.from({ length: n }, (_, i) => i)
        for (let i = n - 1; i > 0; i--) {
          const j = r.int(0, i)
          ;[a[i], a[j]] = [a[j], a[i]]
        }
        return a
      }
      rowA = rowFrom(hex, shuffle(6), shuffle(6))

      const avail = partners(rowA)
      const want = ctx.params.partner
      available = true
      if (want === 'broken') {
        // deliberately not a partner: the nearest transposition that is not one
        const keys = new Set(avail.map((p) => p.kind + p.t))
        let pick: { kind: Kind; t: number } = { kind: 'P', t: 0 }
        for (let t = 0; t < 12; t++) {
          if (!keys.has('P' + t)) {
            pick = { kind: 'P', t }
            break
          }
        }
        chosen = pick
      } else {
        // No falling back. Retrograde at t = 0 works for every row there is,
        // so `?? avail[0]` quietly made every hexachord look combinatorial —
        // asking for a partner a hexachord cannot give you should break the
        // aggregate, visibly, because that is the thing being taught.
        const found = avail.find((p) => p.kind === want)
        available = !!found
        chosen = found ?? { kind: want as Kind, t: 0 }
      }
      rowB = chosen ? transform(rowA, chosen.kind, chosen.t) : [...rowA]

      spans = aggregate(rowA, rowB)
      combinatorial = spans.every((s) => s.missing.length === 0 && s.doubled.length === 0)
      const sc = setClass(hex).join(',')
      label = `(${sc})${isAllCombinatorial(rowA) ? ' — all-combinatorial' : ''}`
    }
    build()
    for (const k of ['hexachord', 'partner', 'seed', 'root'] as const) ctx.onParam(k, build)

    // -- the sound -------------------------------------------------------------

    const strike = (pc: number, oct: number, time: number, gain: number, pan: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const midi = clamp(12 * oct + pc, 12, 108)
      const f = mtof(midi)
      const dec = ctx.params.decay

      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // 6 ms, not 1 — a fast ramp on a sine is a broadband click, and a click
      // has no pitch class at all
      amp.gain.linearRampToValueAtTime(gain, at + 0.006)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.012), at + dec)
      amp.connect(pn)

      const o = ctx.audio.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(amp)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'triangle'
      o2.frequency.value = f * 2
      const g2 = ctx.audio.createGain()
      g2.gain.setValueAtTime(0, at)
      g2.gain.linearRampToValueAtTime(gain * 0.16, at + 0.005)
      g2.gain.exponentialRampToValueAtTime(1e-4, at + dec * 0.35)
      o2.connect(g2).connect(pn)

      o.start(at)
      o2.start(at)
      disposeAt(o, at + dec + 0.08, [amp, pn])
      disposeAt(o2, at + dec + 0.08, [g2])
    }

    // -- the transport ----------------------------------------------------------

    let base = -1
    let pos = 0
    /** What was played most recently, for the drawing. */
    let litA = -1
    let litB = -1

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const m = e.step - base
      const rate = Math.round(ctx.params.rate)
      if (m % rate !== 0) return
      const i = Math.floor(m / rate)
      const alt = ctx.params.texture === 'alternating'
      const n = rowA.length

      const k = alt ? Math.floor(i / 2) % n : i % n
      pos = k

      // Two voices at once means two notes per step, and at a 1.6 s decay that
      // is a lot of them. Scale by the overlap, normalised so the defaults are
      // unchanged.
      const stacked = ((alt ? 1 : 2) * ctx.params.decay) / Math.max(1e-6, e.dur * rate)
      // Alternating sounds one note at a time instead of two, so it needs the
      // density back or the control is quieter than the thing it controls.
      const lvl =
        (0.46 + ctx.params.level * 0.54) * Math.sqrt(2.6 / Math.max(2.6, stacked)) * (alt ? 1.3 : 1)

      const oct = Math.round(ctx.params.octave)
      const sp = Math.round(ctx.params.spread)
      if (alt) {
        if (i % 2 === 0) {
          strike(rowA[k], oct, e.time, lvl, -0.35)
          litA = k
          litB = -1
        } else {
          strike(rowB[k], oct - sp, e.time, lvl, 0.35)
          litB = k
          litA = -1
        }
      } else {
        strike(rowA[k], oct, e.time, lvl, -0.35)
        strike(rowB[k], oct - sp, e.time, lvl, 0.35)
        litA = k
        litB = k
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          litA = -1
          litB = -1
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const gridW = w - pad * 2
      const cw = gridW / 12
      const rowH = Math.max(14, Math.min(30, (h - pad * 2 - 58) / 3))
      const y0 = pad + 14

      g.font = '10px ui-monospace, monospace'
      g.textBaseline = 'alphabetic'

      // the two rows, note by note
      const draw = (row: Row, y: number, lit: number, colour: string, name: string) => {
        g.fillStyle = '#64748b'
        g.fillText(name, pad, y - 4)
        for (let i = 0; i < row.length; i++) {
          const first = i < row.length / 2
          g.fillStyle = i === lit ? '#fff' : first ? colour : '#334155'
          g.fillRect(pad + i * cw, y, Math.max(1, cw - 2), rowH)
          g.fillStyle = i === lit ? '#0f172a' : '#cbd5e1'
          g.fillText(PC[row[i] % 12], pad + i * cw + 3, y + rowH - 5)
        }
        // the line between the hexachords, which is the whole subject
        g.strokeStyle = '#f8fafc'
        g.beginPath()
        g.moveTo(pad + 6 * cw - 1, y - 3)
        g.lineTo(pad + 6 * cw - 1, y + rowH + 3)
        g.stroke()
      }
      draw(rowA, y0, litA, '#7dd3fc', 'voice one — P0')
      draw(rowB, y0 + rowH + 18, litB, '#a78bfa', `voice two — ${chosen ? chosen.kind + chosen.t : '—'}`)

      // the aggregate: one cell per pitch class, per half-row span
      const y2 = y0 + 2 * (rowH + 18)
      g.fillStyle = '#64748b'
      g.fillText('each half-row, twelve pitch classes', pad, y2 - 4)
      for (let s = 0; s < spans.length; s++) {
        const sp = spans[s]
        const count = new Array(12).fill(0)
        for (const p of sp.pcs) count[p]++
        const yy = y2 + s * (rowH * 0.5 + 3)
        for (let p = 0; p < 12; p++) {
          g.fillStyle = count[p] === 1 ? '#4ade80' : count[p] === 0 ? '#1e293b' : '#f87171'
          g.fillRect(pad + p * cw, yy, Math.max(1, cw - 2), rowH * 0.5)
        }
      }

      const miss = spans.reduce((s, x) => s + x.missing.length, 0)
      const dbl = spans.reduce((s, x) => s + x.doubled.length, 0)
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = combinatorial ? '#4ade80' : '#f87171'
      g.fillText(
        combinatorial
          ? `dovetails — 0 missing, 0 doubled`
          : `${miss} missing, ${dbl} doubled${available ? '' : ` — no ${ctx.params.partner} partner exists`}`,
        pad,
        h - pad,
      )
      g.fillStyle = '#64748b'
      g.fillText(
        `${label}   iv ${intervalVector(hex).join('')}   partners ${partners(rowA).length}/48   note ${pos + 1}/12`,
        pad + Math.min(240, w * 0.34),
        h - pad,
      )
    })

    ctx.status('the aggregate, tiled')
  },
})
