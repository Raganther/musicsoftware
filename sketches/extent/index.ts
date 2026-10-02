import { clamp, degree, disposeAt, mtof, reverb, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  bellPartials,
  callPatterns,
  factorial,
  findExtent,
  isTrue,
  legalChanges,
  plainBob,
  plainHunt,
  rounds,
  rowKey,
  sjtExtent,
  type Row,
} from './changes'

/**
 * Composing with permutations instead of pitches.
 *
 * A tower of bells is rung in **rows** — each bell sounds once per row, in some
 * order — and the physical constraint is absolute: a swinging bell takes about
 * two seconds a stroke, so between two rows it can move **at most one place**.
 * Every change is therefore a set of disjoint swaps of *adjacent* positions.
 *
 * Ringers have been walking the Cayley graph of the symmetric group since the
 * 1600s, and the goal has a name: an **extent**, all n! rows exactly once,
 * ending back at rounds. A Hamiltonian cycle. On seven bells that is 5040 rows
 * and about two hours without a break, which is what a peal is.
 *
 * Numbers in `notes` are measured; see `research/log/2026-10-02-extent.md`.
 */

const METHODS = [
  'plain hunt',
  'Plain Bob, plain course',
  'Plain Bob extent',
  'Johnson–Trotter extent',
  'searched extent',
] as const

export default defineSketch({
  title: 'Extent',
  description: 'Change ringing: a composition is a Hamiltonian cycle through every ordering of the bells.',
  tags: ['composition', 'permutation', 'generative'],
  status: 'promising',
  bpm: 108,
  division: 4,

  params: {
    bells: { type: 'number', value: 6, min: 3, max: 8, step: 1, label: 'Bells' },
    method: { type: 'select', value: 'Plain Bob, plain course', options: METHODS as unknown as string[], label: 'Method' },
    /** Which bell's path to draw heavy. Ringers learn a method as one line. */
    line: { type: 'number', value: 2, min: 1, max: 8, step: 1, label: 'Draw the line of' },
    /** 1.2 is the traditional minor-third bell; 1.25 is a major-third bell. */
    tierce: { type: 'number', value: 1.2, min: 1.15, max: 1.27, step: 0.001, label: 'Tierce' },
    ring: { type: 'number', value: 1.5, min: 0.4, max: 3.5, step: 0.05, label: 'Ring' },
    /** The open handstroke lead: one blow of silence after every second row. */
    gap: { type: 'toggle', value: true, label: 'Handstroke gap' },
    root: { type: 'number', value: 50, min: 36, max: 62, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.34, min: 0, max: 0.7, step: 0.01, label: 'Tower' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Each bell sounds **once per row**, and between two rows a bell can move at most
one place — a swinging bell takes two seconds a stroke and cannot be hurried.
So a change is a set of *disjoint adjacent* swaps, and a composition is a walk
in the Cayley graph of the symmetric group. An **extent** is a Hamiltonian
cycle: all n! rows once each, back to rounds.

**How much freedom that leaves.** Choosing disjoint dominoes on n cells is the
Fibonacci recurrence, so the number of legal changes is **F(n+1)** — checked for
n = 1…12:

| bells | 4 | 5 | 6 | 7 | 8 | 10 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| legal changes | 5 | 8 | 13 | 21 | 34 | 89 | 233 |
| that move *every* bell | 1 | 0 | 1 | 0 | 1 | 1 | 1 |

That second row is the whole shape of the art: on an even number of bells there
is **exactly one** change that moves everybody, and on an odd number there are
**none**. You cannot keep every bell moving, so a method must *make places* —
which is why the notation for Plain Bob Minor reads \`-16-16-16-16-16-12\`.

**Plain hunt** closes after exactly 2n rows, all distinct (n = 3…10). **Plain
Bob**'s plain course is n−1 leads of 2n rows, true and legal, and the number of
courses in an extent is exactly **(n−2)!/2** — 1, 3, 12, 60, 360 for 4 to 8
bells. One course of Minimus already *is* the extent; by Major you would need
360 of them.

**Joining the courses is where the counting bites.** Of the 2^12 = 4096 ways to
place bobs in the twelve leads of a 120 of Plain Bob Doubles, exactly **12** are
true. On four bells, 2 of 8. Enumerated, not quoted.

**An extent always exists**, by Steinhaus–Johnson–Trotter: generated to n = 8
(40320 rows), always true, always legal, every bell in every place exactly
(n−1)! times. It is also unringable, and the reason is the point — it moves
**exactly 2** bells per change and stands the rest still. Legality is a far
weaker condition than ringability. The seeded search finds extents that move
2.4–2.6 bells per change instead.

**The bells are minor whether you like it or not.** A tuned bell's partials are
set by shaving metal off the inside, and the traditional target puts the tierce
at 1.2 — exactly 6:5, **315.64 cents**, a just minor third. Major-third bells
(1.25, 386.31 cents) were not achieved until the twentieth century. \`Tierce\`
sweeps between them, and the tune does not change.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 4.5, decay: 3.0 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.connect(rev.input)
    ctx.cleanup(() => {
      // Cleanup runs before the host's own 10 ms fade-out, so disconnecting
      // here would pre-empt it and cut a ringing bell mid-waveform. Hand the
      // teardown to the same timer instead.
      setTimeout(() => {
        bus.disconnect()
        rev.dispose()
      }, 200)
    })

    // -- the composition --------------------------------------------------------

    let rows: Row[] = []
    let label = ''
    let note = ''
    const cache = new Map<string, { rows: Row[]; label: string; note: string }>()

    const compose = () => {
      const n = Math.round(ctx.params.bells)
      const method = ctx.params.method as (typeof METHODS)[number]
      const seed = Math.round(ctx.params.seed)
      const key = `${n}/${method}/${seed}`
      const hit = cache.get(key)
      if (hit) {
        ;({ rows, label, note } = hit)
        return
      }

      let r: Row[]
      let lab: string
      let msg = ''
      if (method === 'plain hunt') {
        r = plainHunt(n)
        lab = `plain hunt on ${n} — ${r.length} rows`
      } else if (method === 'Plain Bob, plain course') {
        r = plainBob(n, n - 1)
        lab = `plain course — ${r.length} of ${factorial(n)} rows, ${factorial(n - 2) / 2} courses make the extent`
      } else if (method === 'Plain Bob extent') {
        const leads = factorial(n) / (2 * n)
        // 2^leads call patterns, so only four and five bells can be enumerated.
        const pats = leads <= 14 ? callPatterns(n, leads) : []
        if (pats.length) {
          const pick = pats[seed % pats.length]
          r = plainBob(n, leads, new Set(pick))
          lab = `extent of ${r.length} — bobs at ${pick.length ? pick.join(', ') : 'no lead'}, 1 of ${pats.length} true patterns`
        } else {
          r = plainBob(n, n - 1)
          lab = `plain course — ${2 ** leads > 1e6 ? `2^${leads}` : 2 ** leads} call patterns is too many to sift`
          msg = `the extent needs ${leads} leads; only 4 and 5 bells are enumerable here`
        }
      } else if (method === 'Johnson–Trotter extent') {
        r = sjtExtent(n)
        lab = `Johnson–Trotter — ${r.length} rows, true, and only 2 bells move at a time`
      } else {
        const found = n <= 5 ? findExtent(n, seed) : null
        if (found) {
          r = found
          lab = `searched extent — ${r.length} rows, seed ${seed}`
        } else {
          r = sjtExtent(n)
          lab = `Johnson–Trotter — the search does not reach ${n} bells`
          msg = 'greedy search with restarts handles 120 rows, not 720'
        }
      }
      rows = r
      label = lab
      note = msg
      cache.set(key, { rows, label, note })
    }
    compose()
    for (const k of ['bells', 'method', 'seed'] as const) ctx.onParam(k, compose)

    /** Mean number of bells that move per change — 2 is the floor, n the dream. */
    const moving = () => {
      if (rows.length < 2) return 0
      let m = 0
      const n = rows[0].length
      for (let i = 1; i < rows.length; i++) {
        for (let b = 0; b < n; b++) if (rows[i - 1].indexOf(b) !== rows[i].indexOf(b)) m++
      }
      return m / (rows.length - 1)
    }

    // -- one bell ---------------------------------------------------------------

    let live = 0
    let dropped = 0

    /**
     * A struck bell, built from its partials. The pitch you hear is the strike
     * note, an octave under the nominal, which is not where the energy is.
     */
    const strike = (midi: number, time: number, gain: number, pan: number) => {
      // The concurrent count is bounded by construction — `ring` over the step
      // length, so 25 at the slowest blow and longest ring — and a dropped
      // bell here is not a thinner texture, it is a **wrong row**. So the cap
      // is set high enough never to bind at this sketch's own tempo, and when
      // a shared transport does outrun it the drops are counted and shown
      // rather than swallowed.
      if (live > 40) {
        dropped++
        return
      }
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const prime = mtof(midi)
      const parts = bellPartials(ctx.params.tierce)
      const base = ctx.params.ring
      const norm = parts.reduce((s, p) => s + p.gain, 0)

      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)

      const made: { o: OscillatorNode; g: GainNode; dec: number }[] = []
      for (const p of parts) {
        const f = prime * p.ratio
        if (f > 16000 || f < 20) continue
        const a = (p.gain / norm) * gain
        const dec = base * p.decay
        const o = ctx.audio.createOscillator()
        o.type = 'sine'
        o.frequency.value = f
        const g = ctx.audio.createGain()
        g.gain.setValueAtTime(0, at)
        // 3 ms: a bell's strike is sharp, but a step into a sine is a click and
        // seven of them at once is louder than the bell.
        g.gain.linearRampToValueAtTime(a, at + 0.003)
        // The floor must never bind, or a quiet partial stops decaying early
        // and rings on as a halo — a constant floor is a relative one.
        g.gain.exponentialRampToValueAtTime(Math.max(1e-9, a * 0.0005), at + dec)
        o.connect(g).connect(pn)
        o.start(at)
        made.push({ o, g, dec })
      }
      if (!made.length) {
        pn.disconnect()
        return
      }
      live++
      let last = 0
      for (let i = 1; i < made.length; i++) if (made[i].dec > made[last].dec) last = i
      made.forEach((m, i) => disposeAt(m.o, at + m.dec + 0.08, i === last ? [m.g, pn] : [m.g]))
      setTimeout(() => live--, (at - ctx.audio.currentTime + made[last].dec) * 1000 + 120)
    }

    /** Bell b, treble first, rings highest: rounds falls down the scale. */
    const pitchOf = (b: number, n: number) =>
      degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, n - 1 - b)

    // -- the transport ----------------------------------------------------------

    let base = -1
    let rowIdx = 0
    let posIdx = -1
    const seen = new Set<string>()
    let repeats = 0
    let rung = 0

    /**
     * Where blow `k` lands. Rows come in pairs — handstroke then backstroke —
     * and the open handstroke lead is one blow of silence after every second
     * row, which is why a tower sounds like it is breathing.
     */
    const blowAt = (k: number, n: number) => {
      const per = ctx.params.gap ? 2 * n + 1 : 2 * n
      const pair = Math.floor(k / per)
      const within = k % per
      if (within >= 2 * n) return null
      return { row: (pair * 2 + Math.floor(within / n)) % rows.length, pos: within % n }
    }

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const n = rows.length ? rows[0].length : Math.round(ctx.params.bells)
      const where = blowAt(e.step - base, n)
      if (!where) {
        posIdx = -1
        return
      }
      rowIdx = where.row
      posIdx = where.pos
      const row = rows[rowIdx]
      if (where.pos === 0) {
        const k = rowKey(row)
        if (seen.has(k)) repeats++
        else seen.add(k)
        rung++
      }
      const bell = row[where.pos]
      // The tenor is heavy and loud, the treble light; and the pan follows the
      // position in the row, so you can hear a bell travel.
      const weight = 0.72 + 0.28 * (bell / Math.max(1, n - 1))
      // A longer ring means more bells sounding at once, and measured the peak
      // goes as about ring^0.47 — 0.070 at 1.5 s against 0.105 at 3.5 s. Divide
      // it out so `Ring` is a decay knob and not a volume knob. The bell count
      // moves the peak by only 1.06x from three bells to eight, which is not
      // worth compensating.
      const lvl = ((0.33 + ctx.params.level * 1.96) * weight) / Math.sqrt(ctx.params.ring / 1.5)
      strike(pitchOf(bell, n), e.time, lvl, -0.55 + (1.1 * where.pos) / Math.max(1, n - 1))
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          seen.clear()
          repeats = 0
          rung = 0
          dropped = 0
        }
      }),
    )

    // -- the grid ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      if (!rows.length) return
      const n = rows[0].length
      const pad = 10
      const top = pad + 13
      const bot = h - pad - 26
      const plot = Math.max(20, bot - top)
      const shown = Math.min(rows.length, Math.max(8, Math.floor(plot / 7)))
      const from = Math.max(0, Math.min(rows.length - shown, rowIdx - (shown >> 1)))
      const rowH = plot / shown
      const colW = (w - pad * 2) / Math.max(1, n - 1)
      const X = (pos: number) => pad + pos * colW
      const Y = (i: number) => top + (i - from) * rowH

      g.font = '10px ui-monospace, monospace'
      g.fillStyle = '#64748b'
      g.fillText(label, pad, top - 4)

      // the row being rung
      g.fillStyle = 'rgba(125,211,252,0.09)'
      g.fillRect(pad - 4, Y(rowIdx) - rowH * 0.5, w - pad * 2 + 8, rowH)

      const drawn = clamp(Math.round(ctx.params.line) - 1, 0, n - 1)
      for (let b = n - 1; b >= 0; b--) {
        const treble = b === 0
        const hero = b === drawn
        g.strokeStyle = treble ? '#fbbf24' : hero ? '#7dd3fc' : 'rgba(148,163,184,0.22)'
        g.lineWidth = treble || hero ? 1.8 : 1
        g.beginPath()
        for (let i = from; i < from + shown && i < rows.length; i++) {
          const x = X(rows[i].indexOf(b))
          const y = Y(i)
          if (i === from) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
      g.lineWidth = 1

      // the blow happening now
      if (posIdx >= 0) {
        g.fillStyle = '#f8fafc'
        g.beginPath()
        g.arc(X(posIdx), Y(rowIdx), 3, 0, Math.PI * 2)
        g.fill()
      }

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = '#e2e8f0'
      g.fillText(rows[rowIdx].map((b) => (b + 1 > 9 ? '0' : String(b + 1))).join(''), pad, h - pad - 13)
      g.fillStyle = repeats ? '#f87171' : '#4ade80'
      g.fillText(
        repeats ? `${repeats} rows repeated` : `${seen.size} distinct of ${factorial(n)} — true`,
        pad + 70,
        h - pad - 13,
      )
      g.fillStyle = dropped ? '#f87171' : '#64748b'
      g.fillText(
        `${legalChanges(n)} legal changes · ${moving().toFixed(2)} of ${n} bells move per change` +
          (dropped ? ` · ${dropped} blows dropped, the transport is faster than the ring` : '') +
          (note ? ` · ${note}` : ''),
        pad,
        h - pad,
      )
    })

    ctx.status(`${isTrue(rows) ? 'true' : 'FALSE'} — rounds is ${rounds(rows[0]?.length ?? 6).map((b) => b + 1).join('')}`)
  },
})
